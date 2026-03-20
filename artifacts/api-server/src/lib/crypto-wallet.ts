import { HDKey } from "@scure/bip32";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58check } from "@scure/base";
import { base58 } from "@scure/base";

// BTC mainnet P2PKH version byte: 0x00
const BTC_VERSION = 0x00;
// LTC mainnet P2PKH version byte: 0x30
const LTC_VERSION = 0x30;
// Tron address version byte: 0x41
const TRON_VERSION = 0x41;

function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey));
}

function p2pkhAddress(pubkey: Uint8Array, version: number): string {
  const hash = hash160(pubkey);
  const payload = new Uint8Array(1 + hash.length);
  payload[0] = version;
  payload.set(hash, 1);
  return base58check(sha256).encode(payload);
}

function tronAddress(pubkey: Uint8Array): string {
  // pubkey must be the 33-byte compressed key; expand to uncompressed for hashing
  // Actually, for Tron we use the uncompressed key's last 64 bytes
  // @scure/bip32 gives us compressed (33 bytes). Expand to uncompressed.
  const uncompressed = uncompressPublicKey(pubkey);
  // Skip the 0x04 prefix, keccak the remaining 64 bytes
  const hash = keccak_256(uncompressed.slice(1));
  // Take last 20 bytes and prepend 0x41
  const payload = new Uint8Array(21);
  payload[0] = TRON_VERSION;
  payload.set(hash.slice(12), 1);
  return base58check(sha256).encode(payload);
}

function uncompressPublicKey(compressed: Uint8Array): Uint8Array {
  // Use secp256k1 to uncompress the public key
  // We do this manually using the curve equation: y^2 = x^3 + 7 (mod p)
  const p = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
  const x = BigInt("0x" + Buffer.from(compressed.slice(1)).toString("hex"));
  const isOdd = compressed[0] === 0x03;

  let y = modSqrt(((x ** 3n + 7n) % p + p) % p, p);
  if ((y % 2n !== 0n) !== isOdd) {
    y = p - y;
  }

  const xBytes = bigintToBytes(x, 32);
  const yBytes = bigintToBytes(y, 32);
  const result = new Uint8Array(65);
  result[0] = 0x04;
  result.set(xBytes, 1);
  result.set(yBytes, 33);
  return result;
}

function modSqrt(a: bigint, p: bigint): bigint {
  // Tonelli-Shanks algorithm
  if (a === 0n) return 0n;
  let q = p - 1n;
  let s = 0n;
  while (q % 2n === 0n) { q /= 2n; s++; }
  if (s === 1n) return modPow(a, (p + 1n) / 4n, p);
  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) z++;
  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(a, q, p);
  let r = modPow(a, (q + 1n) / 2n, p);
  for (;;) {
    if (t === 1n) return r;
    let i = 1n;
    let tmp = (t * t) % p;
    while (tmp !== 1n) { tmp = (tmp * tmp) % p; i++; }
    const b = modPow(c, modPow(2n, m - i - 1n, p - 1n), p);
    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

function bigintToBytes(n: bigint, length: number): Uint8Array {
  const hex = n.toString(16).padStart(length * 2, "0");
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function deriveAddress(currency: string, xpub: string, index: number): string {
  const hdkey = HDKey.fromExtendedKey(xpub);
  // Derive external chain child: m/0/index
  const child = hdkey.deriveChild(0).deriveChild(index);
  if (!child.publicKey) throw new Error("Failed to derive public key");

  if (currency === "BTC") return p2pkhAddress(child.publicKey, BTC_VERSION);
  if (currency === "LTC") return p2pkhAddress(child.publicKey, LTC_VERSION);
  if (currency === "USDT") return tronAddress(child.publicKey);

  throw new Error(`Unsupported currency: ${currency}`);
}

export function getXpubForCurrency(currency: string): string | null {
  if (currency === "BTC") return process.env.CRYPTO_BTC_XPUB || null;
  if (currency === "LTC") return process.env.CRYPTO_LTC_XPUB || null;
  if (currency === "USDT") return process.env.CRYPTO_TRON_XPUB || null;
  return null;
}
