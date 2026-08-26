# zero-gpu

## gpu architecture, compute vs memory

a gpu has two independent resource pools, and almost every performance question comes down to which one a given piece of work is actually limited by: compute (FLOPS, the raw arithmetic throughput of the tensor cores) and HBM bandwidth (GB/s, how fast data can move between HBM, the gpu's main high-bandwidth memory, and the on-chip SRAM/registers that the compute units actually operate on). every kernel that runs on the gpu binds on one of these two resources, rarely both at the same time, so knowing which one is the bottleneck for a given operation tells you exactly what kind of optimization will actually help.

the ratio that decides which resource binds is called arithmetic intensity, AI for short: FLOPs performed divided by bytes moved.

- low AI → memory-bound. the compute units sit mostly idle, stalled waiting for data to arrive from HBM.
- high AI → compute-bound. HBM bandwidth has slack to spare, the arithmetic units (ALUs) are the ones running flat out.

decode, the token-by-token generation step in autoregressive inference, is the canonical memory-bound kernel: producing one token means reading the full weight set (plus the growing kv cache) from HBM, against a comparatively trivial amount of actual arithmetic per byte read. prefill, processing the full input prompt in one pass, is closer to compute-bound: the same weight read gets amortized across many tokens processed together, so the arithmetic intensity is much higher.

there's a secular trend working against this over time: peak FLOPS has scaled faster across successive gpu generations (Hopper to Blackwell, for instance) than HBM bandwidth has. that means the arithmetic intensity required just to stay compute-bound keeps rising generation over generation, so the exact same kernel tends to become more memory-bound relative to peak compute with each new gpu, even though the gpu's absolute bandwidth number is still going up.

nearly every optimization technique covered in this document is best understood as a deliberate move along this compute/memory axis: quantization reduces the bytes moved per value, batching raises the FLOPs extracted per memory read, flash attention avoids HBM round-trips almost entirely by tiling its computation into SRAM instead. the roofline model, plotting achieved TFLOPS against arithmetic intensity relative to the hardware's own ridge point (the AI value at which it transitions from memory-bound to compute-bound), is the standard diagnostic tool for this. it tells you which side of the equation is actually worth attacking before you spend effort optimizing the wrong one.

the memory hierarchy this all sits on is a strict speed-versus-capacity ladder, and every optimization above is really about keeping data as far up the fast end of it as possible:

- **registers** — per-thread, single-cycle access, measured in kilobytes per SM. fastest storage on the chip, and the reason register pressure limits how many warps an SM can run concurrently.
- **SRAM / shared memory** — per-SM scratchpad, roughly 100-200KB per SM on current hardware, order-of-magnitude faster than HBM. this is the tier flash attention deliberately keeps its intermediate scores in.
- **L2 cache** — shared across all SMs, tens of megabytes, the layer that becomes the bottleneck under MIG partitioning discussed later.
- **HBM** — 80GB on an h100, several TB/s, fast in absolute terms and still the slow tier that everything else is trying to avoid touching.
- **host RAM over PCIe** — hundreds of GB available but an order of magnitude slower than HBM again, only worth touching for weight offload (PowerInfer's hot/cold split, covered later) or initial model load.

- **why a gpu instead of a cpu at all** — a cpu optimizes for latency on a few sequential threads with deep branch prediction and large per-core caches; a gpu optimizes for throughput across tens of thousands of simple threads running the same instruction over different data. neural network inference is almost entirely the second shape of problem, huge amounts of identical arithmetic over large arrays with essentially no branching.
- **utilization percent is a misleading metric** — `nvidia-smi` reporting 100% utilization only means at least one kernel was resident during the sampling window, not that the gpu's compute or bandwidth is anywhere near saturated. a badly memory-bound kernel shows 100% utilization while using a small fraction of peak FLOPS, which is why the roofline and profiler-level metrics discussed in the cuda kernels section matter more than the headline number.
- **power and thermals as a real ceiling** — sustained heavy kernels can push a gpu into power or thermal throttling, where clocks drop and effective throughput falls below spec-sheet numbers regardless of how well the kernel is written, one reason benchmark numbers taken from a cold gpu in a short run don't always hold up under sustained production load.

## matrix multiplication, why it's the whole game

`y = xW`, a linear layer, is a matrix multiply, GEMM for short (general matrix multiplication). the core attention operations, `QK^T` and `attn @ V`, are GEMMs. the feedforward blocks inside a transformer are GEMMs. a full transformer forward pass, end to end, is really just a long chain of GEMMs with cheap pointwise operations (normalization layers, activation functions) interleaved between them. the overwhelming majority of the FLOPs spent in both training and inference sit inside GEMM specifically, which is exactly why gpus ship dedicated tensor core silicon just for this operation, separate from the general-purpose CUDA cores used for everything else. the peak TFLOPS number advertised on a gpu's spec sheet is peak tensor-core GEMM throughput, not a general measure of arithmetic speed.

a `(m,k)` matrix multiplied by a `(k,n)` matrix costs `O(mkn)` FLOPs while moving `O(mk+kn+mn)` bytes, so arithmetic intensity scales upward with matrix size, meaning larger matrices get relatively cheaper per byte moved. a batch size of 1 pushes every GEMM in the model toward memory-bound territory; a large batch pushes those same GEMMs toward compute-bound territory instead, this is the direct mechanism through which batch size controls how efficiently the hardware actually gets used. tensor cores also gate on exact shape and data type (fp16/bf16/fp8/int8, plus specific dimension multiples they're tuned for); feeding one an off-spec shape or an unsupported dtype doesn't throw an error, it just silently falls back to a slower execution path, quietly running well below peak.

- **batched GEMM** — many same-shaped GEMMs fused into one kernel launch. what continuous batching produces at the framework level.
- **sparse GEMM** — skips a structured zero pattern in one operand. hardware-accelerated on newer gpus, requires regular structure, not arbitrary sparsity.
- **low-precision GEMM** — fp8/int8 operands, smaller footprint, higher AI per byte moved, at numerical cost.

quantization's speed benefit is partly downstream of this: smaller operands, more elements per memory transaction. sweeping GEMM size/precision on real hardware and plotting the roofline is the direct method for locating a given gpu's memory-to-compute crossover.

- **what a matmul physically is** — every output element is a dot product: one row of the left matrix multiplied element-wise against one column of the right matrix, summed to a single number. an `(m,k) x (k,n)` GEMM computes `m*n` such dot products, each `k` multiply-accumulate operations long, which is where the `O(mkn)` cost comes from directly.
- **tiling** — no real GEMM kernel loads whole matrices at once. it splits both operands into tiles sized to fit SRAM, loads a tile pair, computes their partial contribution, accumulates, and moves on. the entire art of a fast GEMM kernel is choosing tile shapes that keep tensor cores fed while fitting the memory hierarchy above.
- **accumulate in higher precision than you multiply** — tensor cores commonly multiply in bf16/fp8 but accumulate the running sum in fp32. summing thousands of low-precision products directly into a low-precision accumulator loses far more accuracy than the multiplication itself does, so the accumulator width is a separate, deliberate choice from the operand width.
- **the decode-time GEMM is a skinny one** — during single-request decode, `m` (the batch/token dimension) is 1, turning every weight matmul into a matrix-vector product. this is the most memory-bound shape possible, all of the weight bytes moved, almost none of the arithmetic reuse, and it is the precise reason batching is the single highest-leverage throughput lever in serving.
- **why FLOPs estimates are roughly `2 * params * tokens`** — each parameter participates in one multiply and one add per token passing through it, so a 7b model processing 1000 tokens does on the order of 14 TFLOPs of work, a useful back-of-envelope for sanity-checking whether measured throughput is anywhere near what the hardware should deliver.

## cuda kernels

a cuda kernel is a small gpu-resident program written to execute one specific operation (a GEMM, an attention computation, a normalization step) as efficiently as possible on a given piece of hardware. a model's forward pass, at the very lowest level, is really just a scheduled sequence of these kernel launches, one after another, each operating against data sitting in gpu memory.

identical math, very different wall-clock time, depending purely on implementation quality: memory-hierarchy exploitation (registers → SRAM → HBM), dtype/shape tuning, avoidance of unnecessary HBM round-trips (flash attention's whole premise). kernel performance is never implied by the underlying math being simple.

- **hand-written cuda** — max control, max tuning effort, typically fastest for stable, well-known ops.
- **triton** — python-embedded kernel DSL, faster to write/adapt for novel ops, generally behind hand-tuned cuda on peak throughput, far cheaper to iterate.
- **torch.compile / automatic kernel generation** — trades peak performance for near-zero manual kernel-writing, gap closing as compilers mature.

the lowest layer everything else runs on: flash attention is a kernel design, quantized GEMM needs precision-aware kernels, moe routing needs kernels efficient at small many-way batched GEMMs. engine-level choices (attention backend, quant format) are, underneath, kernel-selection decisions.

understanding whether a kernel is running well requires the gpu's own execution model, not just the compute/memory framing above. an nvidia gpu executes work in warps, groups of 32 threads that run the exact same instruction in lockstep, across a fixed number of streaming multiprocessors (SMs), the physical compute units a gpu is built from, an h100 has well over 100 of them. occupancy is the fraction of an SM's available warp slots that are actually filled with active work at any given moment, low occupancy means an SM has spare capacity sitting unused, often because a kernel needs more registers or shared memory per thread than the hardware can afford to run many warps simultaneously. a kernel can be perfectly correct and still run far below peak because of poor occupancy, a failure mode invisible from the roofline model alone, since roofline analysis assumes the hardware is being kept busy, occupancy is precisely the question of whether it actually is.

nsight systems and nsight compute are nvidia's profiling tools for diagnosing exactly this. nsight systems gives a timeline view across the whole system, cpu, gpu, memory transfers, kernel launches, useful for spotting gaps where the gpu sits idle waiting on the cpu to issue the next kernel, a common culprit behind lower-than-expected throughput that has nothing to do with the kernels themselves being slow. nsight compute drills into a single kernel launch, reporting achieved occupancy, memory throughput as a percentage of peak, and where in the roofline model that specific kernel actually lands, this is the tool that turns "this seems slow" into a specific, actionable diagnosis (occupancy-bound, memory-bound, launch-overhead-bound) instead of a guess.

- **kernel launch overhead** — every kernel launch costs a few microseconds of cpu-side work to dispatch. a transformer layer issues dozens of kernels, and a full forward pass hundreds, so at small batch sizes the cpu can genuinely fail to issue work fast enough to keep the gpu busy, a failure mode called being cpu-bound or launch-bound rather than compute- or memory-bound.
- **cuda graphs** — the standard fix for launch overhead: record an entire sequence of kernel launches once, then replay the whole recorded graph as a single dispatch on subsequent steps. this is why serving engines capture graphs at a set of fixed batch sizes during startup, and why `--enforce-eager` (which disables capture) costs steady-state decode throughput.
- **kernel fusion** — merging several consecutive operations into one kernel so intermediate results stay in registers/SRAM instead of round-tripping through HBM between each step. `fused_add_rms_norm` and flash attention are both instances of this same principle applied to different operation sequences.
- **streams and asynchrony** — cuda work is issued into streams, queues that execute in order internally but can overlap with each other. this is what lets a kernel run while a separate memory transfer is in flight, and it's the mechanism underneath overlapping communication with compute in the parallelism sections below.
- **warp divergence** — because a warp's 32 threads execute in lockstep, a conditional branch where some threads take one path and some take another forces the hardware to execute both paths serially with half the threads masked off each time. dense neural network math is naturally branch-free, which is a large part of why it maps onto this execution model so well.

## floating point formats, fp32/fp16/bf16/fp8

every floating point number is stored as three parts, `sign | exponent | mantissa`. the exponent bits set the dynamic range, how large or small a number the format can represent before it overflows or underflows. the mantissa bits set the precision within that range, how finely spaced the representable values are. every format packs these into a fixed total bit budget, so more range necessarily means less precision, and vice versa.

- `fp32` (1 sign bit / 8 exponent bits / 23 mantissa bits) — wide range, high precision, 4 bytes per value. the traditional default for general-purpose numerical computing.
- `fp16` (1/5/10) — half the size of fp32, but its narrow 5-bit exponent overflows or underflows much more easily on very large or very small values. this caused real, documented instability in early mixed-precision training runs.
- `bf16` (1/8/7) — matches fp32's exponent width exactly, so it shares fp32's full dynamic range and doesn't suffer that overflow problem, while trading away mantissa bits (precision) instead. this is exactly why bf16 displaced fp16 as the default for both training and inference: it sacrifices precision, not range, and it's specifically range failures that silently produce NaNs and corrupt a training run.
- `fp8` (commonly laid out as 1/4/3 or 1/5/2) — just 1 byte per value, used primarily for inference today, and increasingly for training as well via correction techniques that compensate for its much coarser precision.

memory and bandwidth scale linearly with bit width, so a narrower format directly raises AI for the same GEMM. cost: rounding error compounding across many sequential ops, magnitude depends on which weights are affected, low-sensitivity weights barely register, high-sensitivity paths degrade measurably.

format is fixed at training time, a property of the checkpoint, not a runtime input. distinct axis from quantization: native training precision vs. a later, separate compression pass. quantization-aware training (QAT) blurs the line, baking a target low-precision format (e.g. fp4 weights + fp8 activations) into training itself, recovering quality that naive post-hoc conversion would lose.

- **why a 7b model is ~14GB** — parameter count times bytes per parameter. 7 billion parameters at bf16's 2 bytes each is 14GB of weights before any kv cache, activations, or framework overhead enters the picture. this one multiplication is the fastest way to sanity-check whether a given model can plausibly fit on given hardware.
- **weights and activations can use different formats** — a checkpoint's stored weight precision and the precision its intermediate activations get computed in are separate choices. fp8 weights with bf16 activations is common, as is the reverse pairing in some quantization-aware training recipes, so "what precision is this model" usually needs two answers, not one.
- **denormals and zero-flush** — values too small for a format's normal exponent range fall into a slower, less precise denormal representation, and gpus commonly flush them to zero outright for speed. rarely matters for inference, occasionally matters for numerical debugging when very small activations silently vanish.
- **microscaling (MX) formats** — newer formats like mxfp8/mxfp4 attach a shared scale factor to each small block of values rather than to a whole tensor, which recovers much of the dynamic range a naive uniform low-precision format would lose. this block-scaling idea is the direct ancestor of nvfp4's two-level scheme covered in the frontier section.
- **fp4 is not usable naively** — 4-bit floating point has so few representable values that straightforward conversion destroys model quality; every production 4-bit format works only because it layers scaling structure (per-block scales, second-level scalars) on top, which is why fp4 arrived as a viable inference format years after fp8 did.

## quantization (int8, awq, gptq)

quantization takes a model checkpoint already trained at higher precision (typically bf16) and maps its weight values into a lower-precision representation, commonly int8 or int4, as a step applied after training is finished. the naive version works by computing a scale factor for a group of weights, rounding those weights into the lower-precision target range using that scale, then dequantizing (multiplying back by the scale) before or during the GEMM at inference time.

rounding error scales inversely with target bit-width, int4 only has 16 representable values per group compared to int8's 256, so the rounding error introduced is proportionally much larger relative to int8. that error also doesn't distribute evenly across all the weights in a model, some weights matter far more to the final output quality than others, so the real constraint here isn't raw compute cost, it's *which specific weights* lose precision and how that localized error propagates forward through the rest of the network.

- **gptq** — layer-by-layer, calibration-dataset-driven, compensates for error already introduced upstream so it doesn't compound uncorrected. post-training, no retrain.
- **awq** — identifies weights multiplied by large activation values (where error gets amplified) and protects those specifically from aggressive rounding. post-training.
- **QAT** — simulates the precision drop during training/fine-tuning itself, weights adapt around the eventual target. best quality retention at a given bit-width, costs real training compute rather than a calibration pass.
- **gguf** — not a quantization algorithm itself but a file format (from llama.cpp) that packages a quantized checkpoint, including mixed-precision layouts where different tensors within the same model use different bit-widths, chosen per-tensor by sensitivity. the dominant format for cpu and consumer-gpu local inference specifically because it bundles the quantized weights, tokenizer, and metadata into a single portable file.

a 7b bf16 checkpoint is ~14GB; int4 drops it under 4GB, directly setting KV cache headroom on fixed-memory hardware and thus max concurrent request count. gptq/awq both assume the fp checkpoint already exists and compress after the fact; QAT collapses that boundary by baking the target precision into training.

- **group size** — quantization scale factors are computed per group of weights, not per whole tensor, with 128 a common group size. smaller groups mean finer-grained scaling and better accuracy, at the cost of storing more scale factors alongside the weights, so the effective bits-per-weight is always slightly above the nominal bit-width.
- **outliers are the actual problem** — transformer activations reliably contain a small number of very large-magnitude values, and a single outlier in a group forces the group's scale factor wide enough to crush precision for every other value sharing it. essentially every serious quantization method (awq's activation-awareness, smoothquant's migration of scale between activations and weights, mixed-precision layouts) is a different answer to this same outlier problem.
- **weight-only vs weight-and-activation** — weight-only quantization (the common case for llm serving) shrinks memory and bandwidth but dequantizes back to higher precision before the actual GEMM, so it doesn't use faster low-precision tensor cores. quantizing activations too lets the GEMM itself run in low precision for real compute speedup, but is harder to do without quality loss precisely because of those activation outliers.
- **what actually gets measured** — perplexity on a held-out corpus is the cheap sanity check, but it's insensitive to failure modes that matter, a quantized model can hold perplexity while degrading noticeably on long-context recall, code generation, or instruction-following. task-level evals on the workload you actually care about are the only reliable check.
- **calibration data matters** — gptq and awq both derive their error compensation from a small calibration set, and a calibration set unrepresentative of production traffic produces a model tuned for the wrong distribution, an easy and mostly invisible way to lose quality.
- **which layers get skipped** — production quantization recipes routinely leave certain layers at higher precision, commonly the embedding table, the lm head, and sometimes the first and last transformer blocks, because those carry disproportionate sensitivity relative to their share of total parameters.

## how data is stored, where it lives, who reads it, how long it lasts

three axes: physical location, read/write owner, lifetime. every category of inference-time data answers these differently, conflating them is the usual source of bad memory intuition.

- **weights** — HBM. write-once at load (or checkpoint swap), read-many by every GEMM kernel touching that layer, every request. lifetime = process lifetime, never freed between requests.
- **activations** — intermediate tensors between layers. SRAM/registers when the kernel is well-fused, spill to HBM when they don't fit on-chip or fusion is missing. write-once-read-once, discarded after the next kernel consumes them. lifetime ≤ one forward pass, often just the gap between two adjacent kernel launches. flash attention's entire premise is keeping the `n x n` score tensor, which would otherwise be a huge activation, resident in SRAM instead of round-tripping HBM.
- **kv cache** — HBM. incremental writes, one token's `K/V` per decode step, read by every subsequent attention call for that sequence. lifetime scoped to the request (or, under prefix caching, to however long a shared prefix stays referenced), freed on completion or page eviction. footprint scales with `batch_size * seq_len`, usually dominates weights as the primary memory consumer under real concurrency.
- **optimizer state** — training-only. adam-style momentum/variance terms, often several multiples of raw weight size. device memory, read/write every step, lifetime = training run. irrelevant at inference, but the reason full fine-tuning needs far more memory than the base checkpoint, and why LoRA (which avoids full optimizer state) exists.
- **checkpoints on disk** — persistent, at-rest form (weights-only for inference; weights + optimizer state for a resumable training checkpoint). read-once at load, write on save. the only category surviving process restart.

diagnostic use: a gpu near-full at idle is near-certainly KV pre-allocation, not a leak. memory climbing across one long generation is KV accumulating, one page per token, by design. memory failing to return to baseline post-burst is either a page-reclaim bug or deliberate prefix-cache retention for reuse, a design choice, not necessarily a defect.

- **cuda context overhead** — simply initializing cuda in a process reserves several hundred megabytes to a couple of gigabytes of gpu memory before a single weight is loaded, which is why the memory a process can actually allocate is always meaningfully less than the card's rated capacity.
- **fragmentation** — repeatedly allocating and freeing differently-sized blocks leaves gaps too small to reuse, so a gpu can report plenty of free memory in aggregate while failing a single large allocation. paged kv cache exists in large part to sidestep exactly this, fixed-size pages are interchangeable and can't fragment the same way.
- **safetensors vs pickle** — the modern checkpoint format (safetensors) stores tensors in a flat, memory-mappable layout with no executable code, unlike older pytorch `.bin` files which are python pickles and can run arbitrary code on load. faster to load and safer to pull from an untrusted source, which is why it became the default.
- **memory-mapped loading** — mapping a checkpoint file into virtual memory rather than reading it into ram first lets the os page weights in lazily and share them across processes, meaningfully cutting load time and host memory pressure on multi-process serving setups.
- **host-to-device transfer** — weights start on disk, get read into host ram, then copy across PCIe into HBM. that PCIe hop is often the slowest single step in model loading, and using pinned (page-locked) host memory lets the transfer run via DMA at full bandwidth instead of being staged through pageable memory.
- **what actually persists** — nothing in HBM survives process exit; a restart re-reads everything from disk. the only durable state in an inference deployment is the checkpoint file itself and whatever the application layer stores externally, the model holds no memory of past requests beyond what a caller resends in the prompt.

## tokenization, bpe, vocab size

before any of the above matters, raw text has to become the integers a model actually operates on. tokenization is that conversion step, splitting text into discrete units (tokens) and mapping each one to an integer id looked up in a fixed vocabulary, the model's embedding table then maps each id to its dense vector representation.

byte-pair encoding (bpe), and the closely related unigram/sentencepiece family, build that vocabulary by starting from individual bytes or characters and iteratively merging the most frequently co-occurring pairs into single tokens, repeated until the vocabulary reaches a target size, commonly in the 32k-128k range for current open models. this is why unfamiliar words often get split into multiple tokens ("tokenization" might become `token` + `ization`) while common words are a single token, frequency in the training corpus directly determines what gets its own token versus what gets built from pieces.

vocab size is a direct tradeoff, not a free parameter. a larger vocabulary means more of the embedding table's parameters (`vocab_size * d_model`, both for the input embedding and, unless weights are tied, the output projection back to vocab-size logits) and a larger final softmax over more classes, but it also means average sequences get encoded in fewer tokens, since more concepts get their own dedicated token instead of being built from several pieces. fewer tokens per input for the same content directly reduces the `O(n^2)` attention cost discussed below, since `n` is smaller, this is the concrete mechanism by which vocabulary size choices ripple all the way through to inference cost.

tokenization also directly sets what gets billed and what gets measured: every latency number in this document (TTFT, TPOT) and every cost number a provider quotes is denominated in tokens, not words or characters, and the exact tokenizer a model uses determines how many tokens a given piece of text actually costs, different tokenizers can encode identical text into meaningfully different token counts.

- **byte-fallback** — a well-built bpe vocabulary includes every individual byte value as a fallback token, so any input, including malformed unicode, emoji, or a language barely represented in the training corpus, can always be encoded, worst case falling back to one token per byte rather than failing outright.
- **special tokens** — reserved vocabulary entries outside the learned merges, marking things like the start/end of a turn, the boundary between a system prompt and user input, or padding. these are what a chat template actually inserts, and mismatching them between training and inference silently degrades output quality without throwing any error.
- **tokenizer mismatch across models** — two different models rarely share a tokenizer, so a token count or a piece of text encoded for one model doesn't transfer meaningfully to another, this is part of why speculative decoding's draft and target models generally need to share a tokenizer to produce directly comparable token sequences.

## the transformer, what the model actually is

everything else in this document is either a component inside this architecture or infrastructure wrapped around it. a transformer is a stack of identical blocks, typically 32 to 100+ of them for current models, each block taking in a sequence of vectors and emitting a sequence of vectors of the same shape, refining the representation a little further at every layer. the model does exactly one thing: given a sequence of tokens, predict a probability distribution over which token comes next.

the full path a request takes through the model:

- **token ids → embedding table lookup** — each integer token id indexes into a `vocab_size x d_model` table, pulling out that token's learned vector. `d_model` (the "hidden size" or "model dimension", commonly 4096 for a 7-8b model) is the width every vector in the model carries from here on.
- **through N identical blocks** — each block runs attention (tokens exchange information with each other), then a feedforward network (each token gets transformed independently), with normalization and residual connections wrapped around both.
- **final normalization → lm head** — a last `d_model x vocab_size` projection turns the final vector for the last position into one raw score (a "logit") per vocabulary entry.
- **softmax → sampling** — logits become probabilities, and a sampling step picks the actual next token from that distribution.
- **append and repeat** — the chosen token gets appended to the sequence, and the whole thing runs again for the next token. this loop is decode, and it is why generation is sequential.

inside a single block, two sub-layers alternate, and they do genuinely different jobs. attention is where tokens look at each other, it is the only place in the entire architecture where information moves *between* positions in the sequence. the feedforward network (FFN, sometimes called the MLP) is the opposite, it processes each token's vector completely independently of every other token, expanding it to a wider intermediate dimension (commonly `4 * d_model`, or with modern gated activations like SwiGLU roughly `2.67 * d_model` across three matrices instead of two), applying a nonlinearity, then projecting back down to `d_model`.

- **the FFN holds most of the parameters** — despite attention getting most of the conceptual attention, the feedforward blocks typically account for roughly two-thirds of a dense model's total parameter count, which is exactly why mixture-of-experts replaces the FFN specifically, and not attention, when it wants to decouple total capacity from per-token compute.
- **residual connections** — every sub-layer adds its output back onto its input (`x = x + sublayer(x)`) rather than replacing it. this "residual stream" running the full depth of the model is what lets gradients flow cleanly through 100 layers during training, and at inference it means each layer applies an incremental edit to a running representation rather than rebuilding it from scratch.
- **causal masking** — for a text-generating (autoregressive/decoder-only) transformer, position `i` is only allowed to attend to positions `≤ i`, never to future tokens. this mask is what makes it valid to train on an entire sequence at once while still using the model to generate one token at a time.
- **decoder-only is the default** — the original 2017 transformer had a separate encoder and decoder for translation. essentially every current text-generation model (llama, qwen, deepseek, gpt-family) is decoder-only, a single stack with causal masking. encoder-only models still exist and dominate a different niche, they're what embedding models (covered later) are built from.
- **weights are frozen at inference** — the parameters never change while serving. everything discussed in this document, batching, caching, quantization, parallelism, is about moving those fixed numbers through the hardware efficiently, not about the model learning anything at request time.

the shape of a model is captured almost entirely by a handful of numbers: `n_layers` (how many blocks are stacked), `d_model` (how wide each vector is), `n_heads` (how many parallel attention heads per block), `d_head` (the width of each head, usually `d_model / n_heads`), the FFN's intermediate width, and `vocab_size`. these are exactly the fields printed in a `config.json` next to any open checkpoint, and they determine everything downstream: parameter count, memory footprint, kv cache size per token, and how the model has to be split if it won't fit on one gpu.

## normalization, layernorm vs rmsnorm

every transformer block wraps its attention and feedforward sub-layers with a normalization step, rescaling activations to keep their magnitude in a stable, consistent range as they flow through dozens of stacked layers. without this, activations tend to drift toward very large or very small magnitudes as depth increases, destabilizing both training and, to a lesser extent, numerical behavior at inference.

layernorm normalizes each token's activation vector by subtracting its mean and dividing by its standard deviation (computed across the feature dimension for that token), then applies a learned scale and shift. rmsnorm simplifies this by dropping the mean-subtraction step entirely, normalizing only by the root-mean-square of the activations, keeping just a learned scale, no shift. rmsnorm turns out to work about as well as layernorm for transformers in practice while being cheaper to compute (one fewer reduction operation, no mean to track), which is why it's become the default normalization layer in most current open models rather than the original transformer's layernorm.

this is a small piece of the overall FLOP budget compared to the attention and feedforward GEMMs, but it appears extremely frequently (multiple times per layer, every layer), so its implementation efficiency still matters, `fused_add_rms_norm`-style kernels that combine the residual addition and the normalization into a single kernel launch (instead of two separate ones) show up by name in real serving-engine startup logs specifically because this operation is called so often that avoiding the extra kernel-launch and memory round-trip overhead adds up.

- **pre-norm vs post-norm** — where the normalization sits relative to a sub-layer's residual connection. post-norm (the original transformer's placement, normalizing after adding the residual) trains less stably at depth. pre-norm (normalizing the input to a sub-layer before it runs, residual added afterward) is what nearly every current model uses instead, since it keeps gradients better-behaved through very deep stacks.
- **why this is memory-bound, not compute-bound** — normalization reads the full activation tensor, computes a small reduction (mean/rms), then writes the full tensor back out, low arithmetic intensity relative to the data moved, exactly the memory-bound case from the gpu-architecture section, which is the concrete reason fusing it with an adjacent operation (like the residual add) is worth doing at all.
- **numerical stability at low precision** — the reduction step (summing squares for rms, or mean/variance for layernorm) is one of the few places in a low-precision model where accumulating in a higher-precision format (fp32) even while the rest of the layer runs in bf16/fp8 meaningfully matters, small errors here propagate into every downstream computation for that token.

## attention, the mechanism

every token produces three vectors via learned linear projections, called query (`Q`), key (`K`), and value (`V`). the actual computation is `scores = QK^T / sqrt(d_k)`, then `weights = softmax(scores)`, then `output = weights @ V`. in plainer terms, each token's query vector gets compared (via dot product) against every other token's key vector to measure relevance, softmax turns those raw relevance scores into normalized weights that sum to 1, and the final output for that token is the weighted sum of everyone's value vectors, weighted by how relevant they were judged to be.

the `QK^T` step is `O(n^2)` in sequence length, `n` being the number of tokens, meaning both the compute cost and the memory needed to hold the resulting score matrix grow with the square of sequence length. double the context length and you quadruple the attention cost, this scaling is completely independent of how large the model itself is, it's purely a function of `n`, the token count. this quadratic growth is the root cause of why processing very long context windows gets so expensive so quickly.

memory-reducing family (kv cache footprint, `O(n^2)` compute unchanged):

- **MHA** — independent `Q/K/V` per head, full per-head `K/V` cache. most memory-expensive, maximum representational flexibility.
- **MQA** — shared `K/V` across all heads, `Q` stays per-head. cache shrinks ~`n_heads`x, quality cost from reduced expressivity.
- **GQA** — heads grouped, shared `K/V` per group. tunable point between MHA and MQA, default for most current open models.
- **MLA** — `K/V` compressed into a latent space before caching, decompressed on read. better savings than GQA at comparable quality, higher implementation complexity, deepseek's architecture line.

compute-restructuring family (changes the `O(n^2)` term itself):

- **sliding window** — bounded context, last `n` tokens only. `O(window)` cost regardless of sequence length, loses anything outside the window (sometimes mitigated by interleaving full-attention layers).
- **linear/recurrent-style (SSM-adjacent)** — running state updated per-token, `O(n)` total, avoids the quadratic term entirely. cheaper for long sequences, historically weaker at precise long-range recall, active research area.

orthogonal, freely composable: a model can run GQA + sliding window simultaneously. flash attention is a third, independent axis, kernel-level, not architectural, covered next. a fourth, also independent axis is positional encoding, covered in the next section (rope, alibi, and their long-context extensions), which handles token order and composes freely with every variant listed here. kv cache footprint from whichever variant chosen directly gates concurrent-request capacity under a fixed memory budget.

- **why divide by `sqrt(d_k)`** — dot products between two `d_k`-dimensional vectors grow in magnitude with `d_k`, and large values pushed through softmax produce a near-one-hot distribution with vanishing gradients. dividing by `sqrt(d_k)` keeps the scores in a range where softmax stays usefully soft, this is the entire reason the term "scaled dot-product attention" exists.
- **what the heads actually do** — heads are not redundant copies. interpretability work has found individual heads specializing in identifiable behaviors: tracking syntactic dependencies, attending to the previous occurrence of the current token, or copying a token seen earlier in context (induction heads, the mechanism widely believed to underlie in-context learning).
- **softmax is the expensive non-GEMM step** — the two matmuls around it are tensor-core work, but softmax itself is a row-wise reduction with exponentials, memory-bound and awkward to parallelize, which is exactly why flash attention's online-softmax reformulation is the load-bearing trick rather than an incidental detail.
- **attention sinks** — models reliably dump large amounts of attention mass onto the very first token(s) in a sequence, apparently as a no-op destination when a head has nothing relevant to attend to. this matters practically: naive sliding-window implementations that evict those first tokens degrade sharply, and keeping a handful of initial tokens permanently resident fixes it.
- **self-attention vs cross-attention** — everything above is self-attention, `Q`, `K`, `V` all derived from the same sequence. cross-attention derives `Q` from one sequence and `K`/`V` from another, the mechanism encoder-decoder architectures use, and the mechanism vision-language models use when a separate image encoder feeds into a text stack.
- **attention is not where the parameters are** — the `Q/K/V/O` projections in a block are typically about a third of that block's parameter count, the feedforward network holds the rest, so attention dominates the *runtime memory and scaling* story while the FFN dominates the *parameter count* story.

## positional encoding, rope

attention itself, as described above, is permutation-invariant, `QK^T` produces the same result regardless of what order the tokens are actually in, nothing in the raw mechanism tells the model that token 3 comes before token 7. positional encoding is the fix, injecting information about each token's position into the computation so order actually matters.

early transformers added a fixed or learned positional vector directly to each token's embedding before the first layer, simple, but this "absolute" positional signal degrades awkwardly when a model is asked to handle sequences longer than anything it saw during training, the model has simply never seen a position index that high.

rotary positional embedding (rope) takes a different approach: instead of adding a positional vector, it rotates the query and key vectors by an angle that depends on their position, applied directly inside the attention computation itself rather than at the embedding stage. the key property this produces: the dot product `QK^T` between a query at position `i` and a key at position `j` ends up depending only on their relative distance `i - j`, not their absolute positions. this relative-distance property is why rope generalizes far better to longer contexts than absolute positional embeddings do, and it's the default positional scheme in most current open models.

- **rope scaling / position interpolation** — compresses the effective position range so a model trained at, say, 4k context can be stretched to handle 32k or more at inference time without retraining, by rescaling position indices to fit within the range the model actually learned. some quality degradation versus native training at that length, but far cheaper than retraining from scratch.
- **yarn (yet another rope extensioN)** — a more refined extension method that scales different frequency components of rope differently rather than uniformly, better preserving quality at extended context lengths than naive linear interpolation.
- **alibi (attention with linear biases)** — a different family entirely, skips explicit positional embeddings and instead directly biases the attention scores by a penalty proportional to the distance between tokens, closer tokens get less penalty, farther tokens get more. simpler mechanism, extrapolates to longer sequences reasonably well without needing scaling tricks, though rope-based approaches remain more common in current frontier models.

this connects directly back to the attention variants covered above. positional encoding is an orthogonal axis to MHA/GQA/MLA and to sliding-window/linear attention. a model's choice of "how tokens know their order" is independent of "how many kv heads it caches" or "whether attention is quadratic or linear." rope composes with essentially all of them.

- **rope's theta / base frequency** — rope assigns each dimension pair a rotation frequency, derived from a base constant (commonly 10000). low frequencies encode coarse, long-range position; high frequencies encode fine, local position. raising the base is one of the simplest long-context extension methods, often called "rope theta scaling."
- **rope is applied every layer, not once** — unlike absolute position embeddings, which get added once at the input, rope rotates `Q` and `K` inside the attention computation of every single layer. positional information is therefore injected repeatedly rather than expected to survive the whole depth of the network.
- **it costs almost nothing** — the rotation is a handful of elementwise multiplies and adds on `Q` and `K`. it's cheap enough that it's usually fused into the surrounding attention kernel rather than run as a separate step.
- **context length is not a hard wall** — a model advertising 32k context was trained with rope configured for that range. pushing beyond it doesn't error out, output quality just degrades. that's what makes interpolation and yarn viable at all, they're rescaling a continuous parameter, not lifting a hard limit.
- **cached kv must match the rope config** — `K` vectors are stored *after* rotation. change the rope scaling settings between requests and any cached prefix computed under the old settings is silently wrong. this is a real footgun when swapping context-length configs on a live server.
- **NoPE (no positional encoding)** — some recent research finds that causal-masked decoder models can learn positional information implicitly, without any explicit encoding at all. the causal mask itself leaks position. still mostly a research direction, not a production default.

## flash attention, the kernel

flash attention computes exactly the same math as standard attention, `QK^T → softmax → @V`, nothing about the underlying arithmetic changes. what changes is where the intermediate results actually live during that computation. standard implementations materialize the full `n x n` score matrix out in HBM, the gpu's slower main memory, before applying softmax and the final weighted sum. flash attention instead tiles the computation into smaller chunks, keeping those intermediate results resident in SRAM, the much faster on-chip memory, and only writes the final output tile back out to HBM once it's done.

standard attention's real-world slowness comes from memory traffic, not from the arithmetic itself, the score matrix has low arithmetic intensity relative to its size, so HBM bandwidth ends up being the binding constraint, a direct real-world instance of the memory-bound case described in the gpu-architecture section above. flashattention (the original implementation), flashinfer, and various triton-based kernels all target this exact same optimization with different tiling and scheduling strategies, competing purely on implementation efficiency for identical underlying math.

key category distinction: flash attention is not a variant of *what* attention computes, that's the MHA/GQA/MLA/sliding-window/linear axis above. it's *how* the computation maps to the memory hierarchy, and it composes underneath any of those architectures interchangeably. conflating kernel choice with architectural choice is the most common error here.

- **online softmax** — the specific mathematical trick that makes tiling possible at all: softmax normally needs the full row of scores before it can normalize any single value, which would seem to force materializing the whole row first. flash attention instead maintains a running maximum and running sum as it processes tiles incrementally, correcting previously-computed partial results as new tiles arrive, so the full row never has to exist in memory at once.
- **backward-pass version** — flash attention isn't inference-only, the same tiling trick applies to computing gradients during training, recomputing needed intermediate values from the tiles rather than storing them, trading a bit of extra compute for a large memory saving during backpropagation too.
- **causal masking for free** — for autoregressive attention (a token can't attend to future tokens), roughly half the score matrix is masked out entirely. flash attention's tiled kernels can skip computing those masked-out tiles altogether rather than computing them and discarding the result, a real compute saving on top of the memory-traffic saving, specific to causal (as opposed to bidirectional) attention.

## kv cache

generating token `t+1` requires the key and value vectors for every token that came before it. recomputing all of those from scratch at every single generation step would mean redoing the full forward pass over the entire prefix on every new token, `O(n)` redundant work per token generated, `O(n^2)` total work across the whole sequence. the kv cache avoids this by storing each token's `K` and `V` vectors the first time they're computed, so generating a new token only requires computing that one new token's own `K`/`V`, while reusing everyone else's already-cached values.

cache size scales as `O(batch_size * seq_len * n_layers * kv_dim)`, growing linearly with both how many requests are being served concurrently and how long each one's context is. this frequently ends up exceeding the memory used by the model's own weights once you're serving many concurrent requests with a reasonably long context length, meaning the kv cache, not the weights themselves, becomes the primary factor limiting how many concurrent requests a gpu can actually serve.

- **contiguous allocation** — one block/request, sized for max possible sequence length. simple, wastes memory to fragmentation and over-reservation for requests that finish short.
- **paged attention** — fixed-size pages, OS-virtual-memory-style, page table maps logical→physical. eliminates over-reservation, enables page sharing across requests, the substrate prefix caching depends on.

kv cache size is downstream of attention variant, upstream of batching capacity: smaller cache/request → more concurrent requests fit → higher throughput.

- **the actual sizing formula** — `2 * n_layers * n_kv_heads * d_head * bytes_per_value` gives kv bytes per token. the leading 2 is for `K` and `V` separately. multiply by sequence length and batch size for the total. this is worth computing by hand once for a real model, the number is usually larger than people expect.
- **worked example** — a 7b-class model with 32 layers, 8 kv heads (GQA), 128 head dim, at bf16: `2 * 32 * 8 * 128 * 2` = 131KB per token. a 32k-token context is roughly 4.3GB for a single request. that's why concurrency, not model size, is what usually exhausts an 80GB card.
- **why `n_kv_heads` and not `n_heads`** — this is exactly where GQA pays off. a model with 32 query heads but 8 kv heads stores a quarter of what full MHA would. the query heads cost compute; only the kv heads cost cache memory.
- **page size** — paged attention allocates in fixed blocks, commonly 16 tokens' worth of kv. smaller pages waste less memory on the final partial block per request. larger pages mean shorter page tables and less indexing overhead per attention call.
- **copy-on-write for forked sequences** — when one prompt generates several parallel completions (n>1 sampling, beam search), the shared prefix's pages get referenced by all branches rather than copied. a page only gets duplicated when a branch actually writes to it. same mechanism an os uses for `fork()`.
- **kv cache offload** — some engines can spill cold kv pages to host ram over PCIe rather than evicting and recomputing them. useful when recompute is more expensive than the transfer, mostly for very long shared prefixes, and a real tradeoff rather than a free win given PCIe's bandwidth.

the cache itself can also be stored at reduced precision, independent of what precision the weights are running at. fp8 kv cache quantization is common in current serving engines: the `K`/`V` vectors get stored at 1 byte per value instead of bf16's 2 bytes, directly halving cache memory footprint, at some accuracy cost concentrated specifically in attention's relevance scoring, since the values feeding `QK^T` are now coarser. this is a separate, independently-toggleable knob from weight quantization, a model can run full-precision weights with a quantized kv cache, or vice versa, because the two live in entirely different parts of the memory budget and get read by different kernels.

## prefix caching

identical shared prefix across requests (system prompt, repeated instruction, shared doc) means identical `K/V` for that span regardless of which request computed it first. cache it once, any request starting with that prefix reuses it directly, only the divergent suffix hits prefill.

benefit scales with shared-content fraction of the workload. long repeated system prompts or shared retrieved docs dominate, large win. fully unique prompts, zero benefit.

- **exact-match / linear prefix caching** — single linear shared prefix match only.
- **radix-tree prefix caching (radixattention)** — cached prefixes as a tree, supports branching/diverging patterns, not just one linear match. suited to multi-turn or agentic workloads sharing a root but diverging downstream, sglang's differentiator.

this is kv sharing generalized across requests instead of within one, a direct extension of paged attention's page-sharing. also why cache-aware routing matters at the load-balancing layer, routing to a cold instance forfeits the benefit entirely regardless of instance homogeneity otherwise.

there's a real eviction question underneath this. cached prefixes occupy kv memory like any other page, so a busy server has to decide what to drop when it needs room. the standard policy is lru: evict whatever hasn't been reused longest, betting that recently-hit prefixes will be hit again soon. that creates a genuine tuning knob. a server handling many distinct system prompts with low reuse wants a smaller prefix-cache budget, leaving more room for active generation. a server handling heavy multi-turn traffic against a handful of shared prompts wants the opposite, since cache hit rate is what's actually producing the throughput win.

- **block-level hashing** — matching happens at page granularity, not per-token. each block of tokens gets hashed together with the hash of the block before it, forming a chain. two requests share cached blocks up to the first point where their chains diverge.
- **prefix caching changes what TTFT means** — a cache hit skips most of prefill, so TTFT collapses. this makes benchmark numbers highly sensitive to whether test prompts share prefixes. a benchmark that reuses one prompt repeatedly is often measuring cache hits, not prefill speed.
- **put the variable part last** — since matching runs left-to-right, a prompt template with a timestamp or user id at the *front* destroys all sharing downstream. moving volatile content to the end of the prompt is a free, large win, and a common real fix.
- **cross-request privacy** — sharing kv pages between different users' requests is safe because a cache hit requires an exact token-sequence match on the prefix. one user can't read another's content, they can only reuse computation for text they already sent themselves.
- **cache hit rate is a first-class metric** — worth exposing and alerting on alongside latency. a sudden drop usually means either a prompt-template change broke sharing, or routing stopped sending related requests to the same instance.
- **it interacts with quantized kv** — cached pages inherit whatever kv precision the server runs. changing kv dtype invalidates the cache entirely, since stored values are no longer comparable.

## prefill vs decode

prefill is the phase where the full input prompt gets processed, all of its tokens are known upfront, so the model can run over the entire thing in one parallel pass. decode is the phase where output tokens get generated one at a time, sequentially, since each new token depends on the one generated just before it.

prefill processes many tokens per weight read, giving it high arithmetic intensity, so it's compute-bound. decode processes just one token per weight read, repeated over and over, giving it low arithmetic intensity, so it's memory-bound. this means the exact same model, running the exact same weights, has opposite bottlenecks depending on which phase it's in, which is why a single optimization technique rarely helps both phases equally.

- **strict separation** — full prefill before any decode step for that request or others in-batch. simple, a long prefill blocks concurrent decode.
- **interleaved/mixed batching** — one scheduling step processes decode for some requests and prefill chunks for others simultaneously. higher throughput, more scheduler complexity.
- **disaggregation** — separate hardware pools per phase, covered below.

TTFT ≈ prefill latency + queueing delay in front of it. TPOT ≈ decode latency, a bandwidth problem. distinct metrics, distinct bottlenecks, a benchmark quoting only one hides half the picture.

- **prefill cost scales with prompt length, decode cost doesn't** — prefill does work proportional to input tokens (superlinearly, once attention's `O(n^2)` term dominates). decode does roughly constant work per output token, regardless of how long the prompt was. that's why a long prompt with a short answer and a short prompt with a long answer stress completely different parts of the system.
- **the metrics that actually matter, named** — TTFT (time to first token), TPOT (time per output token, sometimes ITL, inter-token latency), and end-to-end latency, which is `TTFT + TPOT * output_tokens`. throughput is separate again, measured in requests/sec or total tokens/sec across all concurrent requests.
- **latency and throughput trade against each other** — bigger batches raise total tokens/sec while making any individual request slower. there is no single "fast" configuration, only a chosen point on that curve, and the right point depends on whether a human is waiting on the output.
- **streaming changes the perceived cost** — with server-sent events, users see the first token at TTFT rather than waiting for the full response. this makes TTFT the metric that governs perceived responsiveness, and TPOT the one that governs whether the stream feels smooth once it starts.
- **reasoning models shift the balance hard** — a model that emits a long internal chain of thought before its visible answer spends most of its time in decode. that pushes the bottleneck firmly toward memory bandwidth, and makes decode-side optimizations (speculative decoding, quantization) far more valuable than prefill-side ones.
- **why decode can't just be batched harder** — batching helps decode a lot, but each concurrent sequence needs its own kv cache. memory, not compute, sets the ceiling on how many decode streams fit at once.

## chunked prefill

one long prefill as a single scheduling step blocks the scheduler for its full duration, no interleaving with concurrent decode steps until it finishes. chunked prefill splits it into fixed-size pieces across multiple steps, each step processing one chunk plus pending decode from other requests.

without chunking: worst-case latency spike proportional to prompt length imposed on every concurrent request's decode, a tail-latency/fairness problem, not a total-throughput one, aggregate compute is identical either way, only its distribution over time changes. smaller chunks → finer interleaving, lower worst-case impact, marginally more overhead. larger chunks → closer to unchunked behavior, less overhead, worse tail impact.

addresses the interleaving problem from prefill/decode without touching prefill's compute-bound nature, only the granularity at which the scheduler can preempt it.

the chunk-size knob is usually exposed directly to the operator rather than fixed by the engine, vllm's `max_num_batched_tokens` is the practical setting that governs it, controlling the maximum number of tokens (across all requests, prefill chunks and decode steps combined) processed in a single scheduling step. set it too low and you pay excess per-step scheduling overhead relative to the actual work done; set it too high and a single scheduling step can once again be dominated by one large prefill chunk, eroding the tail-latency benefit chunking exists to provide in the first place. the right value is workload-dependent, it isn't something with a universal correct default, since it trades off against the specific mix of prompt lengths and concurrency a given deployment actually sees.

## continuous batching

fixed batching waits until it has collected a full batch of requests, runs all of them together, and then waits for the slowest request in that batch to finish before starting the next batch. since output lengths vary a lot between requests, the whole batch ends up idling, wasting gpu time waiting on whichever stragglers happen to take longest. continuous batching removes that rigid boundary entirely: the instant any single request finishes, a new waiting request immediately fills the slot that just freed up, without needing to wait for the rest of the current batch.

waste scales with request-length variance in the workload, longer tails relative to median → more accumulated idle time. continuous batching's benefit scales with the same variance. this is the mechanism turning individual GEMMs into large batched GEMMs across concurrent requests, directly raising AI and pushing decode's otherwise memory-bound profile toward better utilization, the request-serving-level realization of the compute/memory tradeoffs discussed throughout. one of the largest differentiators between naive serving code and production engines under real, mixed-length traffic.

- **`max_num_seqs`** — the actual knob controlling how many requests can be batched together in a single decode step at once. higher values extract more throughput from the memory-bound decode phase (more tokens' worth of work sharing the same weight read) but raise per-request kv memory pressure, since every concurrent sequence needs its own cache.
- **preemption under memory pressure** — if the scheduler can't fit every running request's growing kv cache in available memory, it has to preempt (pause and evict) some request to free room, later resuming it by recomputing its kv cache from scratch. this is a direct real-world cost of pushing batch size aggressively, higher concurrency raises throughput until it starts triggering preemption, at which point throughput can actually fall.
- **fairness across requests** — a naive continuous-batching scheduler that always prioritizes whichever request arrived first can starve later arrivals under sustained heavy load; production schedulers generally need some fairness policy (round-robin admission, priority tiers) layered on top of the raw greedy-fill behavior described above.

## speculative decoding, draft models

decode, as covered above, is sequential and memory-bound, requiring one full forward pass through the model per token generated. speculative decoding breaks that sequential dependency: a small, cheap draft model proposes `k` tokens ahead of where generation currently is, and the large target model then verifies all `k` of those proposed tokens in a single parallel forward pass, instead of needing `k` separate sequential forward passes to generate them normally.

speedup is bounded by acceptance rate. high acceptance → multiple tokens/target-forward-pass. low acceptance → most draft work discarded while verification still costs ~normal decode, net loss possible if the draft's distribution is a poor match for the target's. output distribution is exact regardless, never worse than target-only, a rejected guess falls back to the target's own prediction, this restructures compute to expose parallelism, not an approximation.

- **draft-target** — independently trained smaller model, requires distributional compatibility with the target for useful acceptance.
- **EAGLE** — lightweight prediction head on the target's own hidden states, sidesteps distribution-mismatch by not using a separate model.
- **medusa** — multiple parallel decoding heads on the target, each predicting a different future position, no sequential draft step at all.
- **n-gram / lookahead** — pattern-matches repeated structure in current output, no model needed. strong for high-repetition content (code), weak for novel text.

orthogonal to quantization and batching, not a bandwidth optimization but a parallelism-extraction technique, composes with both, a quantized target still speculates, a batched server speculates per-request within the batch.

acceptance rate isn't a fixed property of a draft/target pair, it moves with the content being generated. highly structured, predictable output, boilerplate code, repetitive formatting, common phrasing, tends to produce high acceptance since the draft's guesses are genuinely easy to get right. open-ended, creative, or highly technical generation tends to produce lower acceptance, since there are many plausible next tokens and the draft has less signal to work with. this is why speculative decoding's real-world speedup varies a lot by workload even with the same draft/target pair, a coding assistant and a creative-writing assistant running identical models will see meaningfully different acceptance rates in practice, and that's the number that ultimately determines whether the technique is worth the added complexity for a given deployment.

## mixture of experts

a dense model uses every single parameter for every token it processes. a mixture-of-experts (moe) model instead splits its feedforward portion into many smaller sub-networks called experts, and a lightweight router network selects only the top-`k` of `n` total experts to actually process each token, leaving the rest idle for that particular token. concretely: a token's hidden state goes into the router, the router scores every available expert on relevance to this token, the top-`k` highest-scoring experts get selected, the token is processed only by those chosen experts, and their outputs get combined (weighted by the router's own scores) before the result moves on to the next layer.

total and active parameter counts decouple here, unlike dense where they're equal. total params drive memory footprint (every expert must be resident, the router might select any of them next), active params drive per-token FLOPs. router collapse is the failure mode: disproportionate favoring of a few experts degrades the model toward a smaller dense equivalent, wasting the memory spent on unused experts.

- expert count and top-`k` tune independently, more experts at fixed `k` raises capacity without raising compute, higher `k` raises compute without necessarily raising capacity.
- shared experts, always-active regardless of routing, provide a stable baseline capacity floor.
- sparsity ratio (active/total) varies widely, some frontier open moe models run well under 2% active, far sparser than earlier production deployments.

requires expert parallelism at scale (covered next). fundamentally distinct axis from quantization (precision) or attention variants (token relations), moe changes *which* parameters compute, all three compose independently.

- **the router is tiny** — usually a single linear layer mapping `d_model` to `n_experts`, followed by a softmax or sigmoid and a top-k selection. it's a rounding error in parameter count, but it determines everything about how well the model uses its capacity.
- **only the FFN gets replaced** — attention layers in an moe model stay dense and shared. every token runs through the same attention weights. sparsity applies to the feedforward block only, which is also where most of the parameters live.
- **why moe is cheap to train but awkward to serve** — training cares about FLOPs per token, and moe wins there decisively. serving cares about memory footprint and communication, where moe is strictly worse than a dense model of equivalent active size. that gap is why moe adoption moved faster in research than in production serving.
- **load balancing loss** — the classic training-time fix for router collapse. an auxiliary loss term penalizes uneven expert usage, nudging the router toward spreading tokens out. it works, but adds a hyperparameter that needs tuning, which is what quantile-based approaches are trying to eliminate.
- **batch size affects routing efficiency** — a large batch sends many tokens to each expert, so every expert's GEMM is a reasonable size. a small batch scatters a few tokens across many experts, producing many tiny, inefficient GEMMs. moe models therefore need higher batch sizes than dense models to hit good hardware utilization.
- **fine-grained experts** — the trend in recent architectures is toward more, smaller experts with a higher top-k, rather than fewer large ones. more possible expert combinations per token means more effective specialization at the same active parameter count.

## moe vs dense, when each wins

worth pulling out as its own comparison, since the choice shows up early in any serving decision and the tradeoffs aren't symmetric.

- **dense wins on** — simplicity, predictable memory, no routing communication, efficient at small batch sizes, easier to quantize cleanly, works fine on a single gpu at 7-70b scale.
- **moe wins on** — quality per FLOP, and therefore quality per dollar at high throughput, provided you have enough aggregate memory to hold every expert and enough batch size to keep each one busy.
- **the crossover** — moe generally makes sense once total parameters exceed what a single node can serve densely anyway. below that, dense is usually less operational pain for equivalent quality.
- **a practical asymmetry** — a dense model's serving cost is roughly predictable from its parameter count. an moe model's cost depends heavily on routing behavior under your specific traffic, so it needs benchmarking against real workloads rather than estimation from the spec sheet.

## tensor parallelism

tensor parallelism splits individual layers of a model across multiple gpus, so each gpu holds only a slice of every layer's weights rather than one gpu holding an entire layer, and the gpus communicate with each other to combine their partial results on every single forward pass. concretely, for a linear layer `xW` split across 2 gpus: each gpu computes its own slice of the result independently, then an all-reduce operation (a collective communication step that sums results across gpus) combines the partial outputs into the full result, which then feeds into the next layer, and the whole pattern repeats layer after layer.

communication happens inside every layer's forward pass, demanding nvlink-class interconnects. on slower links, per-layer communication overhead dominates and erodes the latency win. primary use case: lower per-request latency for a model too large for one gpu, or extra latency headroom on one that fits, different objective from pipeline parallelism (below, fits large models with less communication overhead, at the cost of bubbles) and from data parallelism (replicates the whole model for throughput, doesn't split it).

the interconnect gap this depends on is large and worth being concrete about: nvlink on current nvidia hardware runs at several hundred GB/s to well over 1TB/s between gpus in the same node, while standard ethernet networking between separate nodes typically runs one to two orders of magnitude slower. that gap is exactly why tensor parallelism is described as an intra-node technique in practice, not a hard rule but a direct consequence of arithmetic: an all-reduce that costs a negligible fraction of a forward pass's time over nvlink can dominate the entire forward pass if run over standard networking instead, at which point the communication overhead eats the latency benefit tensor parallelism was supposed to provide.

- **column-parallel vs row-parallel** — the two ways a weight matrix actually gets split across gpus. splitting along columns (each gpu computes a portion of the output features) lets each gpu proceed independently until an all-gather is needed to reassemble the full result; splitting along rows requires a partial-sum reduction (the all-reduce described above) after every gpu's contribution. real implementations alternate these two split patterns between consecutive layers specifically to minimize how many communication steps are needed per layer, rather than picking one and paying for an extra sync every time.
- **degree of tensor parallelism** — `tensor_parallel_size` in a serving config is literally the count of gpus a model gets split across for this technique; it has to evenly divide the relevant dimensions of the model (attention head count, in particular, since each gpu typically owns a whole number of heads), which is why TP degree is usually a power of 2 and why it's picked based on both the gpu count available and the model's own architecture, not an arbitrary number.
- **communication overlap** — well-tuned implementations overlap the all-reduce communication with independent compute happening elsewhere (a technique borrowed from distributed training), rather than strictly serializing "compute, then communicate, then compute again," this is one of the harder engineering details that separates a naive TP implementation from a well-optimized one at the same degree.

## pipeline parallelism

pipeline parallelism splits a model by depth instead of by width: gpu 1 holds the first several layers, gpu 2 holds the next block of layers, and so on, with a request's activations flowing sequentially through this pipeline of gpus, each one finishing its portion of the layers before handing off to the next.

communication only at stage boundaries, far less frequent than TP's per-layer traffic, tolerates slower interconnects including cross-node. cost: pipeline bubbles, idle stages waiting on upstream, pronounced at low batch size where there's insufficient concurrent work to fill every stage. micro-batching (splitting a batch into smaller pieces fed sequentially through the pipeline) reduces bubble time.

inverse communication profile to TP: infrequent-but-tolerant vs. frequent-but-latency-sensitive. commonly combined, depth-split across nodes, width-split within a node, alongside data/expert parallelism, each addressing a distinct bottleneck at multi-node scale.

pipeline bubbles are worth quantifying rather than just naming: with `p` pipeline stages and `m` micro-batches fed through per full batch, the fraction of total time lost to bubbles scales roughly as `(p-1)/(p+m-1)`, more stages means a longer pipeline to fill and drain, more micro-batches means that fill/drain overhead gets amortized across more useful work. this is the direct mathematical reason micro-batching exists and why it matters more as pipeline depth (stage count) grows, a 2-stage pipeline can tolerate a small micro-batch count fairly well, a 16-stage pipeline needs many more micro-batches in flight simultaneously to keep the bubble fraction acceptably small.

- **pipeline schedule choice** — the naive schedule (fill, then drain, then move to the next batch) is what the bubble formula above describes; more advanced schedules (interleaved, 1F1B "one-forward-one-backward" in training contexts) reorder when each stage does forward vs. backward work specifically to shrink the bubble fraction further, at the cost of more complex scheduling logic and slightly higher memory use per stage.
- **memory imbalance across stages** — pipeline stages don't automatically hold equal memory: the first stage additionally holds the embedding table, the last stage additionally holds the output projection and lm head, so naive equal-depth splitting can leave the first and last gpus more memory-pressured than the ones in the middle, a real tuning consideration when deciding exactly where to cut the model into stages.
- **inference-specific tradeoff** — pipeline parallelism's bubble cost is much more painful for the low-batch, latency-sensitive decode phase than for the high-batch, throughput-oriented prefill phase, which is part of why pipeline parallelism shows up more often as a training-scale technique than as the primary choice for latency-sensitive inference serving, where tensor parallelism's lower-latency (if more bandwidth-hungry) profile is usually preferred within a node.

## expert parallelism

expert parallelism is specific to mixture-of-experts models: it distributes the different experts across gpus rather than replicating every single expert on every gpu. since each token only activates a small subset of the total experts, a given token's moe computation gets routed dynamically to whichever gpu physically holds the relevant expert(s) for it.

two failure modes beyond TP/PP: routing communication (tokens needing experts on a different gpu require data movement to reach them), and load imbalance (a router favoring certain experts bottlenecks their host gpus while idle-expert gpus waste held memory). quantile-based balancing derives expert allocation directly from router-score quantiles instead of a heuristic auxiliary loss, removing a sensitive tunable hyperparameter.

what makes serving very large moe models feasible without every gpu holding every expert, a memory-distribution technique analogous to TP splitting weight matrices, but along the which-expert axis. also why moe models demand substantial aggregate memory despite modest per-token compute, every expert lives somewhere regardless of activation frequency.

- **all-to-all communication** — the specific collective operation expert parallelism relies on: after routing, tokens need to be shuffled so each one physically arrives at the gpu holding its assigned expert(s), then shuffled back afterward to reassemble the batch in its original order. this is a different, generally more expensive communication pattern than tensor parallelism's all-reduce, since the amount of data moved and which gpus talk to which both depend on the router's token-to-expert assignment, which changes every batch.
- **expert capacity and dropped tokens** — to keep the all-to-all communication predictable and avoid unbounded memory use, real implementations cap how many tokens any single expert can accept per batch (its "capacity"). if the router sends more tokens to a popular expert than its capacity allows, the overflow tokens get dropped (skip that expert, sometimes falling back to a shared expert or passing through unmodified) rather than processed, a real quality cost that ties directly back to the load-imbalance problem discussed above.
- **co-locating experts with their most frequent callers** — some deployments place experts based on observed routing patterns rather than a naive round-robin assignment across gpus, keeping frequently-co-activated experts physically closer (same node, adjacent gpus) to reduce the average distance, and therefore cost, of the all-to-all shuffle.

## disaggregated serving

prefill and decode have opposite hardware profiles, one is compute-bound, the other memory-bound, as covered above. when co-located on the same gpu pool, they end up competing for the same resources: a long-running prefill can stall decode steps for other concurrent requests sharing that gpu, and vice versa. disaggregated serving splits the two phases onto physically separate gpu pools instead, each tuned specifically for its own phase, where the prefill pool computes the kv cache for a request and then transfers it over to the decode pool, which continues generation from there.

kv transfer between pools needs fast interconnects and real orchestration, only pays off once traffic is high enough that the phases were genuinely contending on shared hardware.

- **static** — fixed pool sizes, simpler, less responsive to shifting traffic.
- **dynamic** — pool assignment adjusts to real-time load, better utilization, more scheduling complexity (nvidia dynamo's domain).

a scale-out response to the same asymmetry chunked prefill addresses at the single-gpu scheduling level, interleaving vs. physical separation, not mutually exclusive, a disaggregated decode pool still benefits from continuous batching internally.

the sizing question this raises is a genuine capacity-planning problem, not just an architectural choice: how many prefill gpus versus how many decode gpus a fleet needs depends on the ratio of prefill-to-decode compute time in the actual workload, which itself depends on average prompt length versus average generation length. a workload dominated by short prompts and long generations (a chat assistant, for instance) wants relatively more decode capacity; a workload dominated by long prompts and short generations (summarization, retrieval-augmented question answering) wants relatively more prefill capacity. getting this ratio wrong under-utilizes one pool while starving the other, which is exactly the kind of imbalance nvidia dynamo's dynamic rebalancing (covered below) is built to correct without requiring the operator to hand-tune the split as traffic composition shifts over time.

## vllm

paged attention + continuous batching as the core serving loop, openai-compatible http api. request → scheduler admits, assigns kv pages → continuous batching interleaves prefill/decode with other in-flight requests → tokens stream.

tradeoff: breadth vs. specialization. supporting hundreds of architectures and dozens of quant formats means carrying overhead a narrowly-built engine skips, a purpose-built engine can beat it on one narrow case, vllm wins on not needing custom engineering for the general case. the reference implementation most serving mechanisms here get framed against (paged kv, continuous batching, prefix caching, chunked prefill), since it standardized them, sits at the dynamic-kernel-dispatch end of the interpreted-vs-compiled spectrum, contrast tensorrt-llm below.

under the hood, vllm actually runs two logically separate processes, an api server process handling http, request validation, and tokenization, and one or more engine core processes doing the actual scheduling and gpu execution, communicating over an internal protocol rather than living in the same process. this separation is why a vllm startup log shows distinct `(APIServer pid=...)` and `(EngineCore pid=...)` lines, and it matters operationally: killing the api-server process alone can leave an orphaned engine-core process still holding gpu memory, exactly the kind of stray-process situation worth checking for (`pgrep -af vllm`, checking `nvidia-smi`'s process list) after a server shutdown that doesn't seem to release memory.

- **V1 engine** — vllm's rewritten core (the "V1" architecture, now the default) is where continuous batching, chunked prefill, and prefix caching being on by default actually comes from, earlier versions required more manual flag-tuning to get the same behavior.
- **`--enforce-eager`** — the escape hatch that disables cuda graph capture, trading steady-state decode throughput for faster startup and lower peak memory during initialization, a real tradeoff, not a strictly worse setting, covered in more depth in the practitioner-notes section further down.
- **quantization support breadth** — one of the concrete expressions of vllm's breadth-over-specialization tradeoff mentioned above: fp8, awq, gptq, gguf, and several newer formats (nvfp4, compressed-tensors) are all supported as loadable checkpoint formats, meaning the quantization choice from earlier sections is usually just a matter of pointing `vllm serve` at the right checkpoint variant, not writing custom loading code.

## sglang

overlapping capability with vllm (paged kv, continuous batching), differentiated by radixattention, tree-structured prefix caching supporting branching/diverging patterns rather than one linear match. also ships a structured-generation language built into the request api.

advantage surfaces on tree-shaped prefix-sharing workloads (multi-turn, agent loops with shared-then-diverging context) vs. purely linear sharing. radixattention is simple prefix caching generalized to a branching tree. the deciding factor between engines: heavy branching-prefix structure favors sglang, independent/unrelated requests plus larger ecosystem favors vllm.

concretely, a radix tree stores prefixes as a shared trie structure rather than a flat cache of full sequences: two conversations that share the first 500 tokens of context but diverge afterward store that shared 500-token prefix exactly once in the tree, with each conversation's divergent continuation branching off as its own path. a flat, exact-match cache (vllm's default approach) would need the *entire* prefix, including everything up to the current point, to match another request's prefix exactly before reusing anything, missing the partial-overlap case a tree captures naturally. this is why sglang's advantage compounds specifically in agent frameworks that repeatedly re-send a growing conversation history with a shared root, the deeper and more branching the shared history gets, the more a tree structure outperforms flat matching.

- **structured generation as a first-class primitive** — sglang's own programming model lets a request specify constraints on the output directly (a regex, a json schema, a choice among fixed options) as part of how the generation call itself is written, rather than as a post-hoc validation/retry layer bolted on top, which is the more common pattern elsewhere.
- **origin story** — sglang and radixattention came out of research explicitly focused on efficient serving for programs that make many structured, interdependent llm calls (agent frameworks, multi-step reasoning chains), which explains why its two headline features (radix caching and structured generation) both target that specific workload shape rather than general single-turn chat.
- **overlap with vllm continues to narrow** — vllm has since added its own structured-output support (via xgrammar/guidance) and improved prefix caching, meaning the gap between the two engines on any given feature checklist keeps shrinking even where the underlying architecture (tree vs. flat cache) still differs.

## tensorrt-llm

compiles a model into a hardware-specific, ahead-of-time execution plan rather than dynamically dispatching kernels at request time. model + hardware + config → compiler produces a fixed execution graph → loaded and run with zero per-request kernel-selection overhead.

trades flexibility for raw performance, aggressive AOT optimization since the target model/config is known in advance, but changing either requires rebuilding the plan, slower than pointing a dynamic-dispatch server at a new checkpoint. same compile-ahead-vs-dispatch-dynamically tradeoff as torch.compile, at the whole-engine level. favored for one model at very high sustained scale where compilation investment pays off; disfavored for fast iteration across many models/configs.

the compilation step is doing genuinely aggressive work, not just picking pre-written kernels: it performs operator fusion (merging multiple sequential ops into a single kernel to cut memory round-trips, the same principle behind flash attention's SRAM-tiling and behind `fused_add_rms_norm`, generalized across the whole model graph), and it can bake in fixed shapes and precision choices to avoid the runtime shape/dtype dispatch overhead a dynamic engine pays on every kernel launch. this is why a tensorrt-llm build for a specific model on a specific gpu generation typically doesn't transfer to a different gpu generation without rebuilding, the compiled plan is genuinely hardware-specific, not just model-specific, in a way vllm's dynamically-dispatched kernels aren't.

- **engine build time** — the compilation step itself can take anywhere from minutes to well over an hour depending on model size and the range of shapes/batch sizes being optimized for, a real operational cost every time the model, gpu target, or key configuration changes, distinct from vllm's near-instant "point it at a checkpoint and go" startup.
- **TRTLLM-GEN and cutlass integration** — the specific kernel libraries tensorrt-llm's compiler draws from for its generated GEMM and moe kernels, tightly coupled to nvidia hardware specifically, which is part of why tensorrt-llm is nvidia-hardware-only, unlike vllm which supports amd (via HIP/ROCm) and other backends as well.
- **in-flight batching support** — tensorrt-llm implements its own version of continuous batching (branded "in-flight batching"), so the throughput-under-mixed-length-traffic benefit described in the continuous batching section isn't unique to vllm/sglang, it's present here too, layered underneath the ahead-of-time compilation rather than instead of it.

## nvidia dynamo

orchestration layer for disaggregated serving across a gpu fleet, treats prefill/decode as independently schedulable work, dynamically assignable to whichever gpus fit best, rather than a static per-phase assignment.

only matters at a scale where the phases genuinely contend for resources and enough total traffic/gpu count exists for dynamic rebalancing to beat a static split. sits above engines like vllm/sglang rather than replacing them, orchestrates fleet-level disaggregated scheduling while the underlying engine handles per-gpu mechanics (continuous batching, kv management) within each phase.

the specific engineering problem dynamo is built around is kv cache transfer between the prefill and decode pools, once a prefill gpu finishes computing a request's kv cache, that cache (which can be gigabytes for a long prompt) has to physically move to whichever decode gpu picks up the request next, over the network if the two pools aren't co-located. doing this transfer efficiently at fleet scale, overlapping it with other work rather than making the decode gpu sit idle waiting for the transfer to complete, is a meaningfully harder systems problem than the single-node case, and it's the specific piece dynamo's kv-aware routing and transfer scheduling addresses.

- **engine-agnostic by design** — dynamo is explicitly built to orchestrate vllm, sglang, or tensorrt-llm underneath it interchangeably, it's a coordination layer, not a competing serving engine, which is a different relationship than the vllm-vs-sglang-vs-tensorrt-llm comparison covered above, those three compete with each other, dynamo sits above whichever one is chosen.
- **smart router** — beyond raw prefill/decode rebalancing, dynamo includes request-routing logic that's cache-aware in the same sense as the cache-aware routing discussed in the observability/routing section, extended to a multi-pool, kv-cache-transfer-aware context rather than a single flat pool of interchangeable instances.
- **why this exists now, not earlier** — disaggregated serving only became a mainstream production pattern once traffic volumes at frontier labs and large inference providers grew large enough that prefill/decode contention on shared hardware was measurably costing throughput, dynamo is a direct response to that specific scale threshold being crossed, not a speculative feature built ahead of need.

## deploying and benchmarking an open model on a single gpu

standard flow: start the server against a checkpoint with auth enabled, verify correctness on the resulting openai-compatible endpoint, benchmark under varied load using the engine's own tooling.

load condition determines what the number means:

- **burst benchmark** — many requests fired simultaneously. TTFT dominated by queueing delay stacked in front of requests, not real prefill speed.
- **realistic-rate benchmark** — requests fired at expected traffic rate. TTFT approaches actual prefill latency, queueing largely removed.

the gap between these two, often orders of magnitude on identical hardware/weights, is the clearest empirical proof that scheduling/queueing behavior, not raw model speed, dominates perceived latency under load.

idle memory near-full with 0% utilization reflects deliberate kv pre-allocation, not a leak. dependency fragility is routine in this stack, version mismatches between engine, kernel libraries, and python/cuda versions are a common source of import-time/startup failures, usually a single targeted package version bump, not an environment rebuild.

- **`/v1/models`** — the cheapest possible liveness check, confirms the server process is up and has finished loading before firing real traffic at it. worth checking first, separately from a full chat request, since it isolates "server not up yet" from "server up but something's wrong with generation."
- **auth from the start, not bolted on later** — a gpu server exposed on a public url with no authentication is a real, immediate risk the moment it's reachable, not a hardening step to get to eventually. vllm's `--api-key` flag is a one-line fix, worth setting before the first external request, not after.
- **background process management** — a server started directly in a foreground shell dies the moment that shell session ends; running it via `nohup ... & disown`, or under a proper process supervisor/systemd unit, is what actually keeps it alive across an ssh disconnect, and it's also why checking for lingering processes after a restart matters, vllm's engine-core process (noted in the vllm section above) can survive an api-server shutdown and needs killing separately.

## containerizing a model server

packaging the serving process (engine, pinned cuda/python/library versions, model-loading logic) into a reproducible image. gpu access needs the nvidia container runtime specifically, physical device passthrough, not transparently shareable the way cpu/memory are.

image size and dependency-pinning matter more here than typical web-service containerization, ml serving stacks have deep, version-sensitive dependency chains, an unpinned image risks reproducing the same import-time failures common across this stack in a fresh environment. this is the packaging layer freezing engine + model + kernels into one reproducible unit, a prerequisite for autoscaling, which schedules containers, not bare processes.

whether model weights actually live inside the image is a real design decision with opposite tradeoffs. baking a multi-gigabyte checkpoint into the image itself makes startup fast (no download step) but makes the image itself huge and slow to build/push/pull, and ties a model update to a full image rebuild. keeping the image slim and downloading weights from object storage or a model registry at container start keeps images small and swappable, but adds that download time directly to cold-start latency, exactly the cold-start problem the next section covers, meaning this containerization choice and the autoscaling tradeoff below aren't independent decisions, they compound.

- **layer caching** — container images are built in layers, and a well-ordered dockerfile (dependencies that change rarely near the top, application code that changes often near the bottom) means most builds reuse cached layers instead of rebuilding everything, a small ci/cd detail that matters a lot in practice given how large ml-serving base images already are before any model weights enter the picture.
- **base image choice** — nvidia publishes official cuda-enabled base images matched to specific cuda/driver versions, starting from one of these rather than installing cuda manually onto a generic linux image is what actually avoids the exact version-mismatch failures discussed in the data-storage and deploying sections above, matching the base image's cuda version to what the serving engine and its kernel libraries expect is the real fix, not a workaround.
- **image registries and pull performance** — for a fleet scaling up and down frequently, how fast a node can pull an image (registry proximity, image size, layer caching on the node itself from a previous pull) is a direct, often underestimated contributor to cold-start latency, worth measuring separately from the weight-download time discussed in the next section rather than assuming they're the same cost.

## autoscaling, cold starts, scale to zero

gpu autoscaling differs from typical web-service autoscaling: startup is slow and heavy (multi-gigabyte weight load, engine init, sometimes kernel compilation), not near-instant. a cold start is the latency hit when no warm instance exists and one must spin up from nothing.

direct cost-vs-latency tradeoff. gpus are expensive enough that aggressive scale-down is attractive, but aggressiveness directly worsens cold-start latency for the first post-idle request.

- **scale to zero** — no idle instances. minimal cost, maximal cold-start exposure.
- **warm minimum** — instances always running. zero cold starts, pays for idle gpu time.
- **predictive/scheduled scaling** — anticipates traffic ahead of demand. reduces cold-start exposure without full idle-capacity cost, needs forecastable traffic.

right point depends entirely on traffic shape, bursty/latency-sensitive needs warm capacity despite the idle cost, steady/latency-tolerant can lean toward scale-to-zero.

cold start is worth breaking into its actual stages, since each one is a separate thing to optimize:

- **provisioning** — acquiring the vm or node itself, if scaling from literally zero infrastructure rather than zero replicas. minutes, and largely outside your control.
- **image pull** — fetching the container image, unless it's already cached on that node. ml serving images are large, so this is rarely negligible.
- **weight download** — pulling the checkpoint from object storage, if it isn't baked into the image. often the single biggest chunk for a large model.
- **engine init** — loading weights into HBM, initializing the scheduler, allocating the kv cache pool.
- **cuda graph capture** — recording graphs across a range of batch sizes, if enabled. adds startup time, buys steady-state decode throughput.

a multi-gigabyte model on an uncached node can spend most of its cold start on image pull and weight download alone, before any gpu-specific work begins. that's why keeping images and weights warm on nodes is a separate, usually cheaper lever than keeping whole replicas warm.

- **what to scale on** — cpu utilization is meaningless for gpu serving. queue depth and TTFT are the metrics that actually correlate with users waiting, which makes them the right autoscaling signals. gpu utilization percentage is a weak proxy for the reasons covered in the gpu architecture section.
- **scale-up lag** — the autoscaler reacts to load that already arrived, then waits out the full cold start before the new replica serves anything. for a model with a two-minute cold start, a traffic spike is already over before capacity lands. this is the core argument for predictive scaling over purely reactive scaling.
- **gpu availability is not guaranteed** — unlike cpu instances, requesting more gpus from a cloud provider can simply fail, especially for newer accelerator types in popular regions. capacity planning for gpu fleets has to account for the possibility that scale-up is refused outright.
- **request draining on scale-down** — terminating a replica mid-generation drops in-flight requests. graceful shutdown means refusing new requests, finishing what's in flight, then exiting, which sets a floor on how fast you can safely scale down.
- **the economics are different from web services** — a gpu instance can cost multiple dollars per hour against fractions of a cent for a web server. that gap is why cold-start pain is tolerated in gpu serving in situations where nobody would accept it elsewhere.

## multi-gpu, multi-node capacity

very large models or very high traffic need more than one gpu, sometimes more than one machine. single-node multi-gpu uses TP/PP over nvlink-class interconnects. multi-node extends across machines on comparatively slow networking, constraining which parallelism strategies remain viable.

TP's per-layer communication generally doesn't survive node boundaries, network-speed overhead erodes the benefit. PP's infrequent stage-boundary communication tolerates it far better. capacity planning at this scale is procurement/scheduling as much as technical, gpu count, provider/region, traffic routing across the footprint, built on the parallelism mechanisms above. this is where moe memory requirements and disaggregation's pool-separation needs push toward multi-node, and where fleet-level orchestration becomes relevant.

a common real-world combination across all four parallelism axes covered in this document is worth naming explicitly since it shows how they compose rather than compete: tensor parallelism within a node (across the gpus sharing nvlink), pipeline parallelism across nodes (tolerating the slower cross-node links), data parallelism to replicate that whole tensor+pipeline unit multiple times for throughput, and expert parallelism layered on top specifically for the moe layers if the model has any. this is often written shorthand as `TPxPPxDPxEP`, and it's the actual configuration space large-model deployments are tuning, not a choice between the four techniques but a joint allocation of gpu count across all of them simultaneously.

- **data parallelism, named explicitly** — the simplest of the four axes and worth defining on its own: full, independent copies of the entire model (or the entire TP+PP unit) run on separate groups of gpus, each copy handling a different slice of incoming traffic. no cross-copy communication needed during inference at all, unlike the other three, which is why it's the axis used purely to scale total throughput once a single copy is already sized correctly for latency and memory.
- **context parallelism** — a newer, fifth axis worth naming alongside the main four: splits the sequence dimension itself (not layers, not experts, the token sequence) across gpus for extremely long-context workloads, where even a single request's attention computation and kv cache no longer fit comfortably on one gpu's memory, relevant at context lengths well beyond what fits the techniques covered so far.
- **why the joint allocation matters** — picking TP degree too high wastes nvlink bandwidth headroom that PP could have used more cheaply across nodes; picking DP replicas too low under-uses available throughput capacity even if latency per request is fine, this is a genuine multi-variable optimization problem, not a sequence of independent decisions, which is why real deployments benchmark specific `TPxPPxDPxEP` configurations against their actual traffic pattern rather than picking each number in isolation.

## observability, routing, load balancing

observability at the gpu-serving layer has two distinct sources, and conflating them is a common mistake. the first source is hardware-level telemetry, coming directly from the gpu and driver, independent of whatever engine or model is running. `nvidia-smi` is the baseline tool here, it reports memory used, memory total, utilization percentage, temperature, and power draw, and its `dmon` subcommand (`nvidia-smi dmon`) gives a continuously updating per-second stream of these numbers instead of a single snapshot, useful for watching a card live during a load test. for anything beyond ad hoc checks, NVIDIA's DCGM (Data Center GPU Manager) is the production-grade version, it exposes the same class of metrics (utilization, memory, ECC error counts, power, thermal throttling events) as a proper exporter that prometheus can scrape continuously, which is what most real gpu fleets actually run instead of polling `nvidia-smi` in a loop.

the second source is engine-level telemetry, coming from the inference server itself, not the gpu. this is where TTFT, TPOT, queue depth, number of requests currently running versus waiting, and kv cache occupancy (what fraction of allocated kv pages are actually in use) live. vllm, for instance, exposes these on a `/metrics` endpoint in prometheus's text exposition format out of the box, metrics like `vllm:time_to_first_token_seconds`, `vllm:time_per_output_token_seconds`, `vllm:num_requests_running`, `vllm:num_requests_waiting`, and `vllm:gpu_cache_usage_perc` are the kind of thing a real dashboard is built from. the distinction matters operationally: gpu-level telemetry from DCGM can look perfectly healthy (moderate utilization, no thermal throttling) while the engine-level queue depth is climbing and TTFT is degrading, because the gpu being "not pegged" doesn't mean requests aren't backing up in the scheduler. reading only one of the two sources gives an incomplete, sometimes actively misleading picture.

routing decides which backend instance a given request actually gets sent to, relevant the moment there's more than one model instance, more than one model version, or more than one provider sitting behind a single entry point. this is typically implemented at a proxy layer in front of the actual inference servers, something like envoy, nginx, or a dedicated ai gateway, rather than inside the inference engine itself. load balancing is the specific policy that proxy layer uses to distribute traffic across the available backend instances.

- **round-robin** — cycles through backends in fixed order. simplest, assumes every backend and every request are roughly interchangeable, which is rarely true for inference workloads with wildly varying prompt lengths and cached state.
- **least-connections** — sends each new request to whichever backend currently has the fewest in-flight requests. better than round-robin under uneven request duration, still treats backends as stateless and interchangeable otherwise.
- **power-of-two-choices** — samples two backends at random, checks their current load, and routes to the less-loaded of the two. a common middle ground in large fleets, cheaper to compute than checking every backend's load, but avoids round-robin's blindness to actual load.
- **cache-aware / consistent-hash routing** — routes a request to whichever backend instance already has that request's prompt prefix cached (tying directly back to the prefix caching section above), typically implemented by hashing the prompt's prefix and using that hash to consistently pick the same backend for matching prefixes across many requests. this is the one policy that isn't purely a load-balancing decision, it's explicitly trading perfectly even load distribution for a much bigger win on the requests that share cached context, and it requires the routing layer to actually track which backend holds which cached prefixes, real added state and complexity compared to the stateless policies above.

round-robin and least-connections both treat every backend instance as interchangeable, which directly breaks the benefit of prefix caching: routing a request to a cold instance that's never seen its prefix forces a full prefill from scratch, forfeiting the caching win entirely, even if every backend instance is running identical hardware and an identical model. this is why sglang's radixattention, and cache-aware routing generally, matter as a pair, one without the other leaves real performance on the table.

put together, this is the fleet-level expression of the same single-instance prefix caching mechanism covered earlier, its benefit only holds end-to-end if the routing layer is tracking the same cache state that each individual instance is tracking internally. and the two observability sources feed the operational loop that keeps all of this running: DCGM-level gpu metrics and engine-level queue/latency metrics both feed directly into autoscaling decisions (covered above) from below, while continuously scraped latency metrics are what turn a one-off benchmark run into always-on, real-time production visibility instead of a single point-in-time measurement that goes stale the moment traffic patterns shift.

## benchmarking, and how wrong it goes by default

a benchmark measures performance under a specific, defined load, the resulting number (TTFT, throughput, TPOT) is only meaningful in that context, not a fixed model/server property.

the same server produces radically different numbers under different load, because the metric captures different things depending on load, not because performance is inconsistent. burst load: TTFT dominated by queueing delay ahead of the request, not prefill speed. realistic-rate load: queueing shrinks toward zero, TTFT approaches actual model latency.

- **burst/max-load** — answers "what's the ceiling." peak capacity, worst-case queueing under overload.
- **realistic-rate** — answers "what does a real user experience." normal-condition latency.

not interchangeable, reporting one while implying the other is the single most common way a benchmark misleads.

empirically validates the prefill/decode and gpu-architecture material throughout, queueing-dominated burst latency and compute/memory-dominated realistic latency are two distinct bottlenecks surfacing as two distinct numbers from the same underlying system. before trusting any latency figure, the load condition it was measured under is the subject of the measurement, not optional context.

## open vs closed models

closed: weights never released, api-only access. open: weights public, usually permissive license (some restrict commercial use), runnable on owned infrastructure.

the meaningful axis is operational control, not raw capability, that gap has narrowed and keeps narrowing. closed apis give fixed latency/availability set by the provider. self-hosted open models tune to specific latency/availability/cost targets, at the cost of owning full operational complexity. third-party-hosted open models sit between, someone else runs the infra, the model/config stays inspectable. this choice determines whether the rest of this document is a problem to solve directly or someone else's concern. the constraint increasingly isn't capability, it's whether the model can be served well enough to justify self-hosting over closed-api convenience.

licensing is a genuinely separate axis from "open" versus "closed" and worth not collapsing into the same decision. weights being publicly downloadable doesn't automatically mean unrestricted commercial use, some open-weight releases carry licenses with usage caps (a monthly-active-user threshold above which a separate commercial license is required, for instance), field-of-use restrictions, or attribution requirements, distinct legal terms that matter for any deployment intending to build a product on top of a given checkpoint, not just a research or personal project. "open weights" is a statement about access to the model file, not a statement about what you're legally permitted to do with it, and the two get conflated often enough that checking the actual license text on a specific checkpoint before committing to it is a real, non-optional step.

- **weights-available vs. open-source** — a genuinely finer distinction worth having: releasing weights is not the same as releasing training data, training code, or a reproducible training recipe. most "open" model releases are weights-available, not fully open-source in the software sense, the training data and exact process usually stay proprietary even when the resulting checkpoint is freely downloadable.
- **model cards and documented limitations** — open releases typically ship a model card, disclosing training data composition (or its absence), known biases, evaluation results, and intended/unintended use cases, this is the closest open models get to the kind of accountability closed-api providers handle through their own internal review processes, and it's worth actually reading before deploying, not just downloading the weights.
- **the switching cost asymmetry** — closed-api switching cost is mostly a code change (different endpoint, different request format, handled by something like litellm as discussed earlier). self-hosted open-model switching cost includes re-benchmarking, re-tuning serving configuration, and possibly re-validating quality on your specific workload, this asymmetry is a real, often underweighted factor in the open-vs-closed decision beyond the headline cost-per-token comparison.

## distillation

trains a smaller student to mimic a larger teacher's outputs (or internal representations) as training signal, rather than training from raw data alone. teacher generates outputs/exposes internal states on a training set, student trains to match, inheriting refined behavior without independently discovering it.

a distilled model generally beats an equally-sized model trained conventionally, learning from an already-refined signal rather than raw noisier data, but remains capacity-bounded, approaching the teacher, never fully replicating it, gap size scales with the size differential.

distinct from every other size-reduction technique here: quantization compresses precision post-training, same architecture, same param count. moe changes which parameters activate, doesn't necessarily reduce total or active count. distillation produces a genuinely new, smaller model via a distinct training process. these compose, distill first, quantize the result.

- **response-based (logit) distillation** — student trains to match the teacher's final output distribution (the probability the teacher assigns to each possible next token), the simplest form, needs only the teacher's outputs, not internal access.
- **feature-based distillation** — student trains to match intermediate hidden states or attention patterns inside the teacher, not just its final output, requires access to the teacher's internals, generally transfers more of the teacher's learned structure than output-matching alone.
- **on-policy / self-distillation variants** — the student generates its own outputs and gets corrected against the teacher's judgment of those specific outputs, rather than training purely on a fixed, pre-generated dataset, closer to how some current post-training pipelines actually combine distillation with reinforcement-learning-style feedback.

## fine-tuning vs retrieval augmented generation

fine-tuning: additional training on a base checkpoint, shapes behavior, format, tone, task specialization. RAG: weights untouched, relevant content retrieved externally at request time (typically embedding search over a document store) and injected into the prompt as context.

fine-tuning does not reliably encode new facts from a small dataset, ask a fine-tuned model something specific from its training data and it often confidently fabricates, training shapes behavior patterns, it isn't a lookup mechanism. RAG's constraint is retrieval quality itself, only what actually gets retrieved is usable, a poor match means answering without the relevant information regardless of model capability.

fine-tuning: consistent behavior/format/tone, wrong tool for large or frequently-changing factual content. RAG: large/changing information, update the doc store, no retrain, wrong tool for teaching behavioral consistency since it only affects available information, not usage. both combine often, fine-tune for format/behavior, RAG for the actual factual substrate. distinguishing test: does the need involve the model *knowing* something, or *behaving* a certain way. for dense reference corpora, RAG is the correct default, fine-tuning risks learning surface patterns without reliably retaining the underlying facts.

fine-tuning itself splits into a memory-cost axis worth naming, since "fine-tuning needs a big gpu" isn't uniformly true. full fine-tuning updates every parameter, requiring the full optimizer state described in the data-storage section above, often several multiples of the base checkpoint's own size, which is why full fine-tuning a large model genuinely needs far more memory than just running it for inference. LoRA (low-rank adaptation) instead freezes the base model's weights entirely and trains only a small pair of low-rank matrices injected alongside each frozen weight matrix, the base weights need no gradient or optimizer state at all since they never change, only the small LoRA matrices do. this is why a model that fits comfortably for inference on one gpu often can't be fully fine-tuned on that same gpu, but can be LoRA fine-tuned on it, the memory-expensive part (optimizer state) only applies to a tiny fraction of the total parameter count under LoRA. this connects directly to multi-lora serving: because LoRA adapters are small and the base model stays frozen and shared, a single deployed base model can serve many different LoRA adapters simultaneously, swapping which adapter applies per request, without needing to load a full separate fine-tuned checkpoint for each one.

- **rank as the actual lora knob** — the "low-rank" in LoRA refers to a chosen rank `r`, typically somewhere from single digits to a few hundred, that sets the size of the injected matrices, and therefore both the number of trainable parameters and how much behavioral capacity the adapter has. higher rank means more expressive fine-tuning at the cost of more trainable parameters and more per-adapter memory, lower rank means a smaller, cheaper adapter that can only shift model behavior more narrowly.
- **QLoRA** — combines LoRA with quantization: the frozen base model gets loaded in a quantized format (commonly 4-bit) while the small LoRA matrices themselves still train in higher precision, pushing the memory floor down further, this is the specific technique that makes fine-tuning a 70b-class model plausible on a single consumer or prosumer gpu, rather than needing a full multi-gpu training setup.
- **RAG's own knobs, not just the model side** — retrieval quality itself has real, separate tuning surface beyond "which model generates the final answer": chunk size (how documents get split before embedding), retrieval count (`k`, how many chunks get pulled per query), and re-ranking (a second, often more expensive pass that reorders initially-retrieved results by relevance before they reach the generative model) all materially affect whether the model actually sees the right information, independent of which generative model or embedding model is chosen.

## embedding models

converts input (text, increasingly images/other modalities) into a fixed-length vector such that semantically similar inputs sit close together in vector space, dissimilar inputs sit far apart. one forward pass, one output vector, no autoregressive loop.

quality is bounded by whether training captured the relevant similarity notion for the target use case, semantic-similarity training doesn't transfer to code-search similarity for free. dimensionality is a direct memory/speed tradeoff, higher dims capture more nuance, cost more to store/compare at scale.

no decode loop, no kv growth, no token-by-token generation, no sequential output dependency, so batching many inputs is straightforwardly compute-efficient without continuous-batching-style scheduling complexity. this is the retrieval half of RAG: documents embedded once and stored, a query embedded at request time, nearest stored vectors determine what gets retrieved. meaningfully simpler and cheaper to scale than generative serving specifically because of the missing decode loop.

finding the nearest vectors among millions of stored embeddings by brute-force comparison (checking the query against every single stored vector) doesn't scale, which is why real deployments use approximate nearest neighbor (ann) search instead of exact search, trading a small amount of retrieval accuracy for large speed gains at scale, "approximate" means occasionally missing the true single-nearest vector in exchange for search that's orders of magnitude faster than exhaustive comparison, a tradeoff that's essentially always worth making once a vector store grows past a few thousand entries.

- **HNSW (hierarchical navigable small world graphs)** — builds a multi-layer graph structure over the stored vectors, search starts at a sparse top layer and descends through progressively denser layers, converging on the nearest neighbors quickly. strong query-time speed and accuracy, at the cost of more memory overhead and slower index construction than simpler methods.
- **IVF (inverted file index)** — clusters the vector space ahead of time, a query only gets compared against vectors in the most relevant cluster(s) rather than the whole store. cheaper to build and update than HNSW, generally a bit lower recall at the same speed budget, often paired with product quantization (compressing the stored vectors themselves) for very large-scale stores.
- **similarity metric choice** — cosine similarity and dot product are the two common choices, and which one is correct depends on how the specific embedding model was trained, some models normalize their outputs such that dot product and cosine similarity are equivalent, others don't, using the wrong metric for a given model silently degrades retrieval quality without any obvious error.

## speech recognition and speech synthesis inference

ASR: audio → text. TTS: text → audio. both need streaming for real-time use, ASR chunks incoming audio and produces text incrementally, TTS generates audio incrementally as text arrives so playback starts before the full response synthesizes.

perceived responsiveness is governed by time-to-first-output, not total processing time, the audio-domain analog of TTFT. for conversational use, the gap between utterance-end and audio-playback-start is the felt latency, not total generation time.

- **batch/offline** — full file at once. simpler, higher latency, fine for non-interactive transcription.
- **streaming** — incremental on both ends. required for real-time conversational use.

same shape as the prefill/decode latency-vs-throughput tension, batch maximizes efficiency, streaming minimizes perceived first-response latency at some efficiency cost.

speaker diarization, determining *who* is speaking at each point in an audio stream, not just what's being said, is a separate model/task stacked alongside ASR rather than something ASR produces natively, transcription and speaker-attribution are commonly two distinct pipeline stages. long-audio ASR (an hour-long recording, for instance) hits its own version of the long-context problem covered in the attention section, processing the entire file as one sequence is expensive, so long-form transcription typically chunks audio into overlapping windows, transcribes each independently, and stitches the results together, careful handling at the chunk boundaries to avoid duplicating or dropping words that fall right at a cut point.

## diffusion inference, image and video generation

fundamentally different generation process: starts from noise, iteratively denoises across many steps, each removing noise and adding target structure, until output emerges. no token-by-token generation, no kv cache, no attention over a growing sequence (though diffusion transformers do use attention internally over spatial/patch tokens).

quality/speed governed by step count, more denoising steps → higher fidelity, proportionally higher cost, each step being a full forward pass. different bottleneck shape from decode's bandwidth-bound sequential dependency, closer to a compute-bound step-count problem.

- **many-step** — standard, higher fidelity, higher cost.
- **few-step/single-step** — architectures/training specifically designed for acceptable quality in far fewer steps, a design-time tradeoff, not a runtime config.
- **video** — adds temporal-consistency requirement across frames, not just per-frame quality, substantially raising compute cost.

the kv-cache and continuous-batching vocabulary that dominates llm optimization doesn't transfer here. the analogous target is step count and per-step kernel efficiency. that's why diffusion inference reads as a largely separate discipline, despite sharing hardware and the same GEMM and kernel-efficiency concerns underneath.

- **latent diffusion** — denoising happens in a compressed latent space rather than at full pixel resolution, with a separate vae decoder expanding the final latent into an image at the end. this is what made high-resolution image generation tractable, denoising at full pixel resolution is enormously more expensive.
- **the pipeline is several models, not one** — a typical image generation request runs a text encoder, then the denoising network across many steps, then a vae decoder. each is a separate model with its own memory and compute profile, which makes serving diffusion closer to orchestrating a pipeline than running a single forward pass.
- **classifier-free guidance doubles the cost** — the standard technique for making output follow the prompt runs each denoising step twice, once conditioned on the prompt and once unconditioned, then extrapolates between them. it's a 2x compute multiplier that most deployments simply accept.
- **schedulers** — the algorithm choosing how much noise to remove at each step, and it's swappable independently of the model. different schedulers reach acceptable quality in meaningfully different step counts, so scheduler choice is a real, cheap performance lever.
- **batching is straightforward here** — every request in a batch runs the same fixed number of steps with no sequential dependency between requests. no continuous batching machinery needed, static batching works well, which is a genuine simplification relative to llm serving.
- **DiT models blur the line** — diffusion transformers replace the older u-net backbone with a transformer operating over image patches. attention optimizations like flash attention apply again, and the frontier of image and video generation has largely moved to this architecture.

## vision-language models

accepts image + text input, reasons across both. image → vision encoder → token sequence → concatenated with text tokens → fed into the same transformer, attending across modalities via the standard attention mechanism.

image tokens can be numerous depending on resolution, directly inflating both kv cache memory (scales with total token count regardless of modality origin) and prefill compute. higher resolution costs more on both axes directly.

- **image + text** — standard case.
- **video** — extends across a frame sequence, multiplying token count, effectively many images processed together with temporal structure retained.
- **omni-modal** — extends beyond vision to additional modalities (audio, etc.) via the same token-concatenation principle.

everything downstream of the vision encoder is standard LLM serving mechanics, attention/kv/batching apply unchanged once images become tokens, added complexity sits entirely in preprocessing and its effect on total token count.

## what practitioners learn the hard way

- **persistence mode isn't optional.** idle gpus drop into low-power states; the first CUDA call after idle triggers a cold re-init that adds real latency to whatever request happens to land first. `nvidia-smi -pm 1` keeps the driver's kernel modules resident so this doesn't happen mid-serving. easy to miss because it only bites the first request after any idle gap, never shows up in a benchmark that keeps the gpu warm the whole run.
- **power limiting inference gpus is free throughput per watt, not a tradeoff.** inference workloads rarely touch a gpu's full rated power draw the way training does; capping an h100 well below its 700W envelope (commonly cited around 250-300W for inference-only fleets) barely dents throughput while cutting power/cooling cost meaningfully. this is a training-vs-inference asymmetry most general gpu-tuning advice doesn't distinguish.
- **ECC costs you bandwidth you paid for.** enabling ECC on GDDR-class memory (not HBM, which has ECC essentially free) measured at roughly 6.5% memory overhead, up to 12% bandwidth loss, and 3-10% inference slowdown on real benchmarks. most systems ship ECC off by default for exactly this reason, worth explicitly checking, not assuming, on a new box.
- **`--enforce-eager` is a trap people reach for too early.** vllm suggests it when CUDA graph capture OOMs, and the instinct is to take the suggestion, but eager mode gives up CUDA graph's steady-state decode throughput entirely, a bad trade on anything h100-class or larger. the actual fix in most OOM-during-capture cases: temporarily lower `--max-model-len`, let CUDA graphs compile and cache (via torch.compile's cache), then raise context length back up on restart. keeps the throughput win, avoids the OOM.
- **`gpu-memory-utilization` isn't as absolute as it looks.** the free memory CUDA reports at process start can already be 1-3GiB less than the card's rated total, driver/context overhead eats into it before your process even starts. this matters most during rolling deploys, a `maxSurge: 1` update briefly runs old and new pods on the same gpu, both requesting the same utilization fraction, and the new one can OOM on a card that looks like it should have room.
- **hot/cold parameter locality is real and exploitable.** neuron/expert activation in real workloads follows a power-law distribution, a small subset gets hit constantly, the long tail rarely fires. PowerInfer built an entire consumer-gpu serving engine around this: keep hot-activated parameters resident on gpu, push cold ones to cpu, and only pay the cpu-gpu transfer cost for the rare long-tail activation. reported up to 11.69x over naive cpu-offload serving on a single rtx 4090. the same locality principle is part of why expert-parallelism load balancing matters so much, an unbalanced router actively fights this locality instead of exploiting it.
- **MIG has a bottleneck nobody puts on the spec sheet.** under power-constrained operation, nvidia's own research found the L2 cache fabric interface, not raw compute or memory bandwidth, becomes the limiting factor for MIG-partitioned workloads. relevant if squeezing multiple tenants onto one gpu under a power cap, not something visible from the advertised per-partition TFLOPS numbers alone.

## what's currently shipping at the frontier

- **NVFP4** — a 4-bit float format with a two-level scaling scheme (a fine-grained e4m3 block scale plus a second fp32 scalar layer) specifically designed to keep accuracy usable at 4-bit precision, where naive int4/fp4 quantization historically fell apart. nvidia reports up to 50x energy efficiency per token on blackwell ultra vs. hopper for a 1.8t-parameter moe model, this is the current best-in-class answer to "how low can precision go before quality collapses."
- **rubin, the generation after blackwell** — announced at roughly 50 PFLOPs NVFP4 inference throughput per gpu, cited as a 5x jump over blackwell's inference numbers, with a new transformer engine doing hardware-accelerated adaptive compression specifically to let NVFP4 hold fp8-level accuracy at trillion-parameter scale. ships second half of 2026, worth tracking since it directly resets the "how big a model fits comfortably" math this entire document has been built around.
- **software-only gains on existing hardware are still large.** nvidia reported up to 2.8x inference throughput improvement on already-deployed blackwell gpus from tensorrt-llm updates alone, zero hardware change, three months apart. a useful reminder that a gpu's ceiling isn't fixed at purchase time, kernel and engine-level software maturity is still a large, moving lever on already-owned hardware.

## sources for the practitioner-notes and frontier sections

- [PowerInfer: Fast LLM Serving with a Consumer-grade GPU](https://arxiv.org/html/2312.12456v2) — hot/cold neuron locality, 11.69x over llama.cpp
- [GPU Power Management: Persistence Mode](https://gigagpu.com/gpu-power-management-persistence-mode/) — cold-init latency, persistence mode
- [Quad RTX3090 GPU Power Limiting with Systemd and Nvidia-smi](https://www.pugetsystems.com/labs/hpc/quad-rtx3090-gpu-power-limiting-with-systemd-and-nvidia-smi-1983/) — inference power-limiting practice
- [MIG L2 fabric bottleneck under power constraints](https://www.mexc.com/news/753464) — nvidia MIG power-envelope research
- ECC overhead figures (6.5% memory, up to 12% bandwidth, 3-10% inference slowdown) — measured on NVIDIA A6000 via CUDA samples and MLPerf v4.1 inference benchmarks
- [vLLM Tuning For Low Memory](https://somethinghitme.com/2026/01/20/vllm-tuning-for-low-memory/) and [Practical strategies for vLLM performance tuning](https://developers.redhat.com/articles/2026/03/03/practical-strategies-vllm-performance-tuning) — gpu-memory-utilization, enforce-eager tradeoffs
- [community CUDA-graph-vs-enforce-eager tip](https://x.com/TheAhmadOsman/status/2048608672348045540) — the max-model-len-then-restart trick
- [Introducing NVFP4 for Efficient and Accurate Low-Precision Inference](https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/) — NVFP4 two-level scaling, 50x energy efficiency figure
- [Nvidia Says Rubin Will Deliver 5x AI Inference Boost Over Blackwell](https://www.hpcwire.com/2026/01/05/nvidia-says-rubin-will-deliver-5x-ai-inference-boost-over-blackwell/) and [Inside the NVIDIA Vera Rubin Platform](https://developer.nvidia.com/blog/inside-the-nvidia-rubin-platform-six-new-chips-one-ai-supercomputer/) — rubin performance figures
- software-only 2.8x blackwell inference gain via tensorrt-llm updates — nvidia-reported, three-month interval, no hardware change
