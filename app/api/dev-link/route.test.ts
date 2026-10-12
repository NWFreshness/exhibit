import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/auth", () => ({
  devOutbox: { exhibitLinks: new Map([["owner@ridge.example", "http://localhost/magic"]]) },
}));
import { GET } from "./route";

const ask = async () =>
  (await (await GET(new Request("http://x/api/dev-link?email=owner@ridge.example"))).json()).url;

describe("dev-link route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the link in dev with no mail server", async () => {
    vi.stubEnv("SMTP_HOST", "");
    expect(await ask()).toBe("http://localhost/magic");
  });
  it("never returns a link in production, even with no mail server", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await ask()).toBeNull();
  });
});
