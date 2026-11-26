// Structural + algebraic check of assets/qr.js: finder/timing/dark modules,
// both format-info copies as valid BCH words, zero Reed-Solomon syndromes,
// and a from-scratch decode that must return the original text.
//
// NOTE: this shares no code with the encoder but it does share my reading of
// the spec, so it cannot catch a misplaced function pattern on its own - a
// transposed format-info block once passed this test while being unscannable
// by every real phone. Always also decode a rendered PNG with a third-party
// decoder. On macOS:  swiftc test/vision-decode.swift && ./vision-decode x.png
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../assets/qr.js", import.meta.url), "utf8");
const g = {}; new Function("globalThis", src)(g);
const { encode } = g.QR;

// GF(256), written independently
const E = [], L = [];
for (let i = 0, x = 1; i < 255; i++) { E[i] = x; L[x] = i; x = x << 1; if (x > 255) x ^= 0x11d; }
const mul = (a,b) => (!a||!b) ? 0 : E[(L[a]+L[b]) % 255];

const SPEC = {1:[10,1,16,0,0],2:[16,1,28,0,0],3:[26,1,44,0,0],4:[18,2,32,0,0],5:[24,2,43,0,0],
  6:[16,4,27,0,0],7:[18,4,31,0,0],8:[22,2,38,2,39],9:[22,3,36,2,37],10:[26,4,43,1,44]};
const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
const MASKS=[(r,c)=>(r+c)%2===0,(r)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,
 (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>(r*c)%2+(r*c)%3===0,
 (r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0];

// polynomial remainder, used to confirm the format/version strings are valid BCH words
function rem(v, poly, bits) {
  for (let i = 30; i >= bits; i--) if (v >>> i & 1) v ^= poly << (i - bits);
  return v;
}

function funcMask(size, version) {
  const fn = Array.from({length:size},()=>new Array(size).fill(false));
  const mark=(r,c)=>{ if(r>=0&&c>=0&&r<size&&c<size) fn[r][c]=true; };
  for (const [br,bc] of [[0,0],[0,size-7],[size-7,0]])
    for (let r=-1;r<=7;r++) for (let c=-1;c<=7;c++) mark(br+r,bc+c);
  for (let i=0;i<size;i++){ mark(6,i); mark(i,6); }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if ((r===6&&c===6)||(r===6&&c===size-7)||(r===size-7&&c===6)) continue;
    for (let dr=-2;dr<=2;dr++) for (let dc=-2;dc<=2;dc++) mark(r+dr,c+dc);
  }
  for (let i=0;i<9;i++){ mark(8,i); mark(i,8); }
  for (let i=0;i<8;i++){ mark(8,size-1-i); mark(size-1-i,8); }
  if (version>=7) for (let i=0;i<18;i++){
    mark(size-11+(i%3), Math.floor(i/3)); mark(Math.floor(i/3), size-11+(i%3));
  }
  return fn;
}

function readFormat(m, size) {
  let f = 0;
  const bits = [];
  // bits 0-5 run DOWN column 8; bits 9-14 run LEFT along row 8 (ISO fig. 25)
  for (let i=0;i<=5;i++) bits[i]=m[i][8];
  bits[6]=m[7][8]; bits[7]=m[8][8]; bits[8]=m[8][7];
  for (let i=9;i<=14;i++) bits[i]=m[8][14-i];
  for (let i=14;i>=0;i--) f = (f<<1) | (bits[i]?1:0);
  const raw = f ^ 0x5412;
  return { ec: raw >>> 13, mask: (raw >>> 10) & 7, valid: rem(raw, 0x537, 10) === 0 };
}
function readFormat2(m, size) {
  const bits=[];
  for (let i=0;i<=7;i++) bits[i]=m[8][size-1-i];
  for (let i=8;i<=14;i++) bits[i]=m[size-15+i][8];
  let f=0; for (let i=14;i>=0;i--) f=(f<<1)|(bits[i]?1:0);
  return f ^ 0x5412;
}

function decode(m, version) {
  const size = m.length;
  const fmt = readFormat(m, size);
  const fmt2 = readFormat2(m, size);
  const fn = funcMask(size, version);
  // unmask
  const u = m.map(r=>r.slice());
  for (let r=0;r<size;r++) for (let c=0;c<size;c++)
    if (!fn[r][c] && MASKS[fmt.mask](r,c)) u[r][c] = !u[r][c];
  // read zig-zag
  const bits=[];
  let colPair = 0;
  for (let right=size-1; right>=1; right-=2) {
    if (right===6) right=5;
    const upward = colPair % 2 === 0;
    for (let k=0;k<size;k++){
      const r = upward ? size-1-k : k;
      for (const c of [right, right-1]) if (!fn[r][c]) bits.push(u[r][c]?1:0);
    }
    colPair++;
  }
  const bytes=[];
  for (let i=0;i+8<=bits.length;i+=8){ let b=0; for(let j=0;j<8;j++) b=(b<<1)|bits[i+j]; bytes.push(b); }
  // de-interleave
  const [ecLen,n1,d1,n2,d2]=SPEC[version];
  const nb=n1+n2, dataTotal=n1*d1+n2*d2;
  const blocks = Array.from({length:nb},(_, i)=>[]);
  let p=0;
  for (let i=0;i<Math.max(d1,d2);i++) for (let b=0;b<nb;b++){
    const size_b = b<n1?d1:d2; if (i<size_b) blocks[b].push(bytes[p++]);
  }
  const ec = Array.from({length:nb},()=>[]);
  for (let i=0;i<ecLen;i++) for (let b=0;b<nb;b++) ec[b].push(bytes[p++]);
  // RS syndromes must all be zero
  let synOK = true;
  for (let b=0;b<nb;b++){
    const cw=[...blocks[b],...ec[b]];
    for (let s=0;s<ecLen;s++){
      let v=0; for (const byte of cw) v = mul(v, E[s]) ^ byte;
      if (v!==0) synOK=false;
    }
  }
  // parse payload
  const flat=[]; for (const b of blocks) flat.push(...b);
  let bi=0; const take=(n)=>{ let v=0; for(let i=0;i<n;i++){ v=(v<<1)|((flat[bi>>3]>>>(7-(bi&7)))&1); bi++; } return v; };
  const mode=take(4), len=take(version<10?8:16);
  const payload=[]; for (let i=0;i<len;i++) payload.push(take(8));
  return { fmt, fmt2OK: fmt2 === (fmt.ec<<13 | fmt.mask<<10 | rem(fmt.ec<<13|fmt.mask<<10, 0x537,10)),
           synOK, mode, text: new TextDecoder().decode(new Uint8Array(payload)) };
}

const cases = [
  "a",
  "HELLO WORLD",
  "https://wedding-invitation-ivory-kappa.vercel.app/",
  "Emily & James \u2014 9 June 2027",          // multi-byte UTF-8
  "https://example.com/" + "x".repeat(60),     // v7, carries version info
  "https://example.com/" + "y".repeat(150),
  "https://example.com/" + "z".repeat(185),    // v10, the ceiling
];
let fail = 0;
for (const text of cases) {
  const m = encode(text);
  const size = m.length, version = (size-17)/4;
  // structure checks
  const sc = [];
  if (!Number.isInteger(version) || version<1 || version>10) sc.push("bad size");
  for (const [br,bc] of [[0,0],[0,size-7],[size-7,0]])
    for (let r=0;r<7;r++) for (let c=0;c<7;c++){
      const d=Math.max(Math.abs(r-3),Math.abs(c-3));
      if (m[br+r][bc+c] !== (d!==2 && d<=3)) sc.push(`finder ${br},${bc}`);
    }
  for (let i=8;i<size-8;i++){ if (m[6][i]!==(i%2===0)) sc.push("timing row"); if (m[i][6]!==(i%2===0)) sc.push("timing col"); }
  if (m[size-8][8] !== true) sc.push("dark module");
  if (m.some(row=>row.some(v=>v===null))) sc.push("unfilled module");

  const d = decode(m, version);
  const ok = d.text===text && d.synOK && d.fmt.valid && d.fmt.ec===0 && d.mode===4 && d.fmt2OK && sc.length===0;
  if (!ok) fail++;
  console.log(`${ok?"PASS":"FAIL"}  v${version} ${size}x${size} mask=${d.fmt.mask}  "${text.slice(0,34)}${text.length>34?"…":""}"`);
  if (!ok) console.log("   ", {struct:[...new Set(sc)], syn:d.synOK, fmtValid:d.fmt.valid, ec:d.fmt.ec, mode:d.mode, fmt2:d.fmt2OK, got:d.text.slice(0,40)});
}
console.log(fail ? `\n${fail} FAILING` : "\nAll cases pass.");
