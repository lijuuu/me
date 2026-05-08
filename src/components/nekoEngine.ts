// minimal neko engine — chase cursor only
class NekoEngine {
  el: HTMLElement; img: HTMLImageElement; sprites: string[] = [];
  fps = 120; speed = 24; idleThresh = 6;
  state = 0; tick = 0; stateCnt = 0;
  x = 0; y = 0; lx = 0; ly = 0; plx = 0; ply = 0;
  tx = 0; ty = 0; otx = 0; oty = 0;
  dx = 0; dy = 0; ldx = 0; ldy = 0;
  bw = 0; bh = 0;
  mx: number | null = null; my: number | null = null; hasMouse = false;
  running = false; iv: any = null;
  tickAcc = 0;
  animTable = [[28,28],[25,28],[26,27],[29,29],[30,31],[0,0],[1,2],[9,10],[13,14],[5,6],[15,16],[3,4],[11,12],[7,8],[17,18],[23,24],[21,22],[19,20]];

  constructor(opts: any = {}) {
    this.fps = opts.fps || 120; this.speed = opts.speed || 24;
    this.idleThresh = opts.idleThreshold || 6;
    this.bw = document.documentElement.clientWidth - 32;
    this.bh = window.innerHeight - 32;
    this.el = document.createElement("div");
    this.el.style.cssText = `position:fixed;width:64px;height:64px;image-rendering:pixelated;pointer-events:none;z-index:999999;left:${this.x}px;top:${this.y}px;margin:0;padding:0;border:none;background:transparent;user-select:none`;
    this.img = document.createElement("img");
    this.img.style.cssText = "width:100%;height:100%;background:transparent;border:none;margin:0;padding:0;max-width:none;display:block;user-select:none;-webkit-user-drag:none;pointer-events:none";
    this.el.appendChild(this.img);
    document.body.appendChild(this.el);
    document.addEventListener("mousemove", (e: MouseEvent) => { this.mx = e.clientX; this.my = e.clientY; this.hasMouse = true; });
    window.addEventListener("resize", () => { this.bw = document.documentElement.clientWidth - 32; this.bh = window.innerHeight - 32; });
    this.x = Math.random() * this.bw; this.y = Math.random() * this.bh;
    this.lx = this.x; this.ly = this.y; this.plx = this.x; this.ply = this.y;
    this.tx = this.x + 16; this.ty = this.y + 31; this.otx = this.tx; this.oty = this.ty;
  }
  setSprites(s: string[]) { this.sprites = s; this.updateSprite(); }
  updateSprite() {
    if (!this.sprites.length) return;
    const f = this.state === 4 ? this.animTable[this.state][(this.tick >> 2) & 1] : this.animTable[this.state][this.tick & 1];
    if (this.sprites[f]) this.img.src = this.sprites[f];
  }
  setState(s: number) { this.tick = 0; this.stateCnt = 0; this.state = s; }
  start() { if (this.running) return; this.running = true; this.iv = setInterval(() => this.update(), 1000 / this.fps); }
  stop() { this.running = false; if (this.iv) { clearInterval(this.iv); this.iv = null; } }
  destroy() { this.stop(); if (this.el.parentNode) this.el.parentNode.removeChild(this.el); }
  update() {
    this.tickAcc += 5 / this.fps;
    while (this.tickAcc >= 1) {
      this.tickAcc -= 1; this.plx = this.lx; this.ply = this.ly;
      this.tick++; if (this.tick >= 9999) this.tick = 0;
      if (this.tick % 2 === 0) this.stateCnt++;
      this.chaseMouse();
      this.updateSprite();
    }
    const t = this.tickAcc;
    this.x = this.plx + (this.lx - this.plx) * t;
    this.y = this.ply + (this.ly - this.ply) * t;
    this.el.style.left = Math.round(this.x) + "px";
    this.el.style.top = Math.round(this.y) + "px";
  }
  chaseMouse() {
    if (!this.hasMouse) { this.runTo(this.lx + 16, this.ly + 31); return; }
    this.runTo(this.mx! - 30, this.my! - 30);
  }
  runTo(tx: number, ty: number) {
    this.otx = this.tx; this.oty = this.ty; this.tx = tx; this.ty = ty;
    const xd = tx - this.lx - 16; const yd = ty - this.ly - 31;
    const d = Math.sqrt(xd * xd + yd * yd);
    if (d === 0) { this.dx = 0; this.dy = 0; }
    else if (d <= this.speed) { this.dx = Math.trunc(xd); this.dy = Math.trunc(yd); }
    else { this.dx = Math.trunc((this.speed * xd) / d); this.dy = Math.trunc((this.speed * yd) / d); }
    this.ldx = this.dx; this.ldy = this.dy;
    const ms = !(this.otx >= this.tx-this.idleThresh && this.otx <= this.tx+this.idleThresh && this.oty >= this.ty-this.idleThresh && this.oty <= this.ty+this.idleThresh);
    switch (this.state) {
      case 0: if (ms) this.setState(5); else if (this.stateCnt >= 4) { if (this.dx < 0 && this.lx <= 0) this.setState(16); else if (this.dx > 0 && this.lx >= this.bw) this.setState(17); else if (this.dy < 0 && this.ly <= 0) this.setState(14); else if (this.dy > 0 && this.ly >= this.bh) this.setState(15); else this.setState(1); } break;
      case 1: if (ms) this.setState(5); else if (this.stateCnt >= 10) this.setState(2); break;
      case 2: if (ms) this.setState(5); else if (this.stateCnt >= 4) this.setState(3); break;
      case 3: if (ms) this.setState(5); else if (this.stateCnt >= 3) this.setState(4); break;
      case 4: if (ms) this.setState(5); break;
      case 5: if (this.stateCnt >= 3 + Math.floor(Math.random()*20)) this.setDir(); break;
      case 6:case 7:case 8:case 9:case 10:case 11:case 12:case 13: {
        let nx = this.lx + this.dx; let ny = this.ly + this.dy;
        const wasOut = nx <= 0 || nx >= this.bw || ny <= 0 || ny >= this.bh;
        this.setDir();
        nx = Math.max(0, Math.min(this.bw, nx)); ny = Math.max(0, Math.min(this.bh, ny));
        if (wasOut && nx === this.lx && ny === this.ly) this.setState(0);
        else { this.lx = nx; this.ly = ny; }
      } break;
      case 14:case 15:case 16:case 17: if (ms) this.setState(5); else if (this.stateCnt >= 10) this.setState(2); break;
    }
  }
  setDir() {
    if (this.dx === 0 && this.dy === 0) { this.setState(0); return; }
    const lx = this.dx; const ly = -this.dy; const l = Math.sqrt(lx*lx+ly*ly);
    const s = ly / l; const sp8 = 0.382683; const s3p8 = 0.92388;
    let ns: number;
    if (this.dx > 0) {
      if (s > s3p8) ns = 6; else if (s > sp8) ns = 11; else if (s > -sp8) ns = 9; else if (s > -s3p8) ns = 13; else ns = 7;
    } else {
      if (s > s3p8) ns = 6; else if (s > sp8) ns = 10; else if (s > -sp8) ns = 8; else if (s > -s3p8) ns = 12; else ns = 7;
    }
    if (this.state !== ns) this.setState(ns);
  }
}

export { NekoEngine };
