/**
 * Tests never talk to the network. A mock that stops covering the code under test used to fall
 * through to the real Anthropic API — real requests, on a real key, billed for real. Failing here
 * instead makes that a loud test failure rather than a line on an invoice.
 *
 * A test that genuinely needs fetch can stub it itself; this only replaces the global default.
 */
const blocked: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Test tried to reach the network: ${url}. Mock it instead.`);
};

globalThis.fetch = blocked;
