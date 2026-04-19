import { test, expect } from "@playwright/test";

test("SPA HTML response carries hardened security headers", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);

  const headers = res.headers();

  const csp = headers["content-security-policy"];
  expect(csp, "CSP header must be present").toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");

  expect(headers["x-frame-options"]).toBe("DENY");

  const hsts = headers["strict-transport-security"];
  expect(hsts, "HSTS header must be present").toBeTruthy();
  expect(hsts).toContain("max-age=");

  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
