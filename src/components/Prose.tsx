export default function Prose({ html }: { html: string }) {
  return (
    <div
      data-prose
      className="flex flex-col gap-3 text-[13px] leading-[1.55] font-normal
        text-[#444444]
        [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-0 [&_h2]:text-[#111111]
        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-0 [&_h3]:text-[#1a1a1a]
        [&_h3+_p]:mt-0.5
        [&_p]:leading-[1.55]
        [&_a]:underline [&_a]:text-[#111111]
        [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:leading-[1.55] [&_li]:mt-0.5
        [&_code]:text-[11px] [&_code]:bg-[#111111]/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#111111]
        [&_pre]:overflow-x-auto [&_pre]:border-l-[2px] [&_pre]:border-[#111111]/20 [&_pre]:bg-white/[0.015] [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:leading-[1.45] [&_pre]:text-[#444444]
        [&_pre_code]:!text-inherit [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
        [&_blockquote]:border-l-2 [&_blockquote]:border-[#111111]/15 [&_blockquote]:pl-3 [&_blockquote]:text-[#444444]
        [&_hr]:border-[#111111]/[0.08] [&_hr]:my-4
        [&_img]:w-full [&_img]:rounded-sm [&_img]:my-2
      "
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
