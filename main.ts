// A tiny stack VM for make.fun's tiny-stack-vm-01 ISA (the kit's ISA.md):
// 32-bit wrapping integers, a 256-value data stack, a 64-deep call stack,
// 256 words of memory, byte input/output, and the ISA's traps, each with
// its own exit code. Runs every program under /input/<id>/ and writes
// /output/<id>/stdout.bin and /output/<id>/exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [immediate bytes, values popped, values pushed] for each opcode byte.
const META: ([number, number, number] | undefined)[] = [];
for (const [b, im, po, pu] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1],
  [0x03, 0, 1, 0], [0x04, 0, 1, 2], [0x05, 0, 2, 2],
  [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1],
  [0x13, 0, 2, 1], [0x14, 0, 2, 1], [0x15, 0, 2, 1],
  [0x16, 0, 2, 1], [0x17, 0, 1, 1], [0x18, 0, 2, 1],
  [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1],
  [0x20, 0, 2, 1], [0x21, 0, 2, 1], [0x22, 0, 2, 1],
  [0x30, 2, 0, 0], [0x31, 2, 1, 0], [0x32, 2, 1, 0],
  [0x33, 2, 0, 0], [0x34, 0, 0, 0],
  [0x40, 0, 1, 1], [0x41, 0, 2, 0],
  [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1], [0x53, 0, 1, 0],
]) META[b] = [im, po, pu];

const STACK_MAX = 256;
const CALLS_MAX = 64;
const MEM_WORDS = 256;
const STEP_LIMIT = 1_000_000;
const OUT_MAX = 65_536;

function run(prog: Uint8Array, input: Uint8Array): { out: Uint8Array; code: number } {
  const st = new Int32Array(STACK_MAX);
  const cs = new Int32Array(CALLS_MAX);
  const mem = new Int32Array(MEM_WORDS);
  const out = new Uint8Array(OUT_MAX);
  let sp = 0, cp = 0, pc = 0, ip = 0, ol = 0, steps = 0;
  const done = (code: number) => ({ out: out.slice(0, ol), code });
  for (;;) {
    if (steps === STEP_LIMIT) return done(10);
    if (pc < 0 || pc >= prog.length) return done(9);
    const op = prog[pc];
    const meta = META[op];
    if (!meta) return done(5);
    const [imm, pops, pushes] = meta;
    if (pc + imm >= prog.length) return done(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return done(2);
    if (sp - pops + pushes > STACK_MAX) return done(3);
    pc = next;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: st[sp++] = (prog[next - 1] << 24) >> 24; break;
      case 0x02: st[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; }
      case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1], a = st[sp - 2];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return done(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (op !== 0x30) { const v = st[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (cp === CALLS_MAX) return done(7);
        cs[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr >= MEM_WORDS) return done(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1], v = st[sp - 2];
        if (addr < 0 || addr >= MEM_WORDS) return done(6);
        sp -= 2;
        mem[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(st[sp - 1]);
        if (ol + s.length > OUT_MAX) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > OUT_MAX) return done(11);
        out[ol++] = st[--sp] & 255;
        break;
      case 0x52:
        st[sp++] = ip < input.length ? input[ip++] : -1;
        break;
      case 0x53:
        return done(st[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
