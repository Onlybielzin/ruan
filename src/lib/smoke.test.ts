import { describe, it, expect } from "vitest";
import { totalBytes, truncate } from "./smoke";

describe("totalBytes", () => {
  it("soma bytes ASCII", () => {
    expect(totalBytes(["ab", "c"])).toBe(3);
  });

  it("conta bytes UTF-8 multibyte", () => {
    expect(totalBytes(["á"])).toBe(2);
  });

  it("lista vazia retorna 0", () => {
    expect(totalBytes([])).toBe(0);
  });
});

describe("truncate", () => {
  it("nao corta quando cabe", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("corta e adiciona reticencias", () => {
    expect(truncate("abcdef", 3)).toBe("abc...");
  });

  it("limite exato nao corta", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("max negativo lanca erro", () => {
    expect(() => truncate("abc", -1)).toThrow();
  });
});
