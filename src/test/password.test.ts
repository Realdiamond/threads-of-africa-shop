// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectImageType } from "@/backend/admin/media.server";
import {
  generatePassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/backend/auth/password.server";
import { slugify } from "@/lib/slug";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("salts every hash, so equal passwords never produce equal hashes", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "plain-text-password")).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(passwordProblem("owner@example.com", "OWNER@example.com")).toMatch(/email/);
    expect(passwordProblem("x".repeat(129))).toMatch(/at most/);
    expect(passwordProblem("a decent passphrase")).toBeNull();
  });

  it("generates readable, unpredictable temporary passwords", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toHaveLength(16);
      expect(password).toMatch(/^[A-Za-z2-9]+$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });
});

describe("detectImageType", () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
  const webp = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

  it("recognises JPEG, PNG and WebP by their bytes", () => {
    expect(detectImageType(Uint8Array.from(png))).toBe("image/png");
    expect(detectImageType(Uint8Array.from(jpeg))).toBe("image/jpeg");
    expect(detectImageType(Uint8Array.from(webp))).toBe("image/webp");
  });

  it("refuses everything else, including SVG, GIF and scripts renamed as images", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(detectImageType(text("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(detectImageType(text("GIF89a......"))).toBeNull();
    expect(detectImageType(text("<script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
    // RIFF container that is not WebP (e.g. WAV)
    expect(
      detectImageType(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
      ),
    ).toBeNull();
  });
});

describe("slugify", () => {
  it("makes web-address-safe handles", () => {
    expect(slugify("Amara Ankara Maxi Dress")).toBe("amara-ankara-maxi-dress");
    expect(slugify("  Café — Crème & Co.  ")).toBe("cafe-creme-co");
    expect(slugify("Roots & Play (Kids)")).toBe("roots-play-kids");
    expect(slugify("!!!")).toBe("");
  });
});
