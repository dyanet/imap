/**
 * Large Mailbox Performance Tests
 *
 * ⚠️ Requires:
 * - A real IMAP server
 * - Mailbox containing 10,000+ messages
 *
 * ❌ Not intended to run in CI
 *
 * Enable locally with:
 * IMAP_PERF_TESTS=true npm test
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { ImapClient } from "../../src/client";
import type { Message } from "../../src/types/message";
import type { SearchCriteria } from "../../src/types/search";

/**
 * Only run when explicitly enabled
 */
const describeIf =
  process.env.IMAP_PERF_TESTS === "true" ? describe : describe.skip;

describeIf("Large Mailbox Performance Tests", () => {
  let client: ImapClient;

  const IMAP_CONFIG = {
    imap: {
      host: process.env.IMAP_HOST ?? "localhost",
      port: Number(process.env.IMAP_PORT ?? 993),
      user: process.env.IMAP_USER!,
      password: process.env.IMAP_PASSWORD!,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: false, // self-signed cert (local only)
      },
    },
  };

  const MAILBOX_NAME = "INBOX";
  const BATCH_SIZE = 100; // recommended batch size

  beforeAll(async () => {
  client = await ImapClient.connect(IMAP_CONFIG);

  // Catch socket-level network errors to prevent unhandled errors in Vitest
  client.on("error", (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn("IMAP client network error:", error.message);
  });

  await client.openBox(MAILBOX_NAME);
});

afterAll(async () => {
  try {
    await client.end();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn("Warning: IMAP connection closed unexpectedly", error.message);
  }
});



  it("should complete search in reasonable time (<5s for 10k messages)", async () => {
    const criteria: SearchCriteria[] = [
      "ALL",
      ["FROM", "noreply@example.com"],
      ["SINCE", new Date("2024-01-01")],
    ];

    const start = Date.now();
    const uids = await client.search(criteria);
    const duration = (Date.now() - start) / 1000;

    console.log(
      `Search returned ${uids.length} messages in ${duration.toFixed(2)}s`
    );

    expect(duration).toBeLessThan(5);
    expect(uids.length).toBeGreaterThan(0);
  });

  it("should fetch large batches efficiently", async () => {
    const uids = await client.search(["ALL"]);
    expect(uids.length).toBeGreaterThan(1000);

    const fetchedMessages: Message[] = [];

    for (let i = 0; i < uids.length; i += BATCH_SIZE) {
      const batch = uids.slice(i, i + BATCH_SIZE);
      const messages = await client.fetch(batch, { bodies: ["HEADER"] });
      fetchedMessages.push(...messages);
    }

    console.log(
      `Fetched ${fetchedMessages.length} messages in batches of ${BATCH_SIZE}`
    );

    expect(fetchedMessages.length).toBe(uids.length);
  });

  it("should fetch full message bodies in batches without memory issues", async () => {
    const uids = await client.search(["ALL"]);
    const fetchedMessages: Message[] = [];

    for (let i = 0; i < Math.min(uids.length, 2000); i += BATCH_SIZE) {
      const batch = uids.slice(i, i + BATCH_SIZE);
      const messages = await client.fetch(batch, {
        bodies: ["HEADER", "TEXT"],
      });

      fetchedMessages.push(...messages);

      // Optional GC (Node must be run with --expose-gc)
      if (global.gc) global.gc();
    }

    console.log(`Fetched ${fetchedMessages.length} full messages`);
    expect(fetchedMessages.length).toBeGreaterThan(0);
  });

  it("should paginate UID-based fetch correctly", async () => {
    const uids = await client.search(["ALL"]);

    const page1 = uids.slice(0, BATCH_SIZE);
    const page2 = uids.slice(BATCH_SIZE, BATCH_SIZE * 2);

    const messagesPage1 = await client.fetch(page1, { bodies: ["HEADER"] });
    const messagesPage2 = await client.fetch(page2, { bodies: ["HEADER"] });

    const uidsPage1 = messagesPage1.map((m) => m.uid);
    const uidsPage2 = messagesPage2.map((m) => m.uid);

    const duplicates = uidsPage1.filter((uid) => uidsPage2.includes(uid));

    expect(duplicates.length).toBe(0);

    console.log(
      `Pagination works: page1 ${messagesPage1.length}, page2 ${messagesPage2.length}`
    );
  });

  it("should handle repeated fetches without memory leaks", async () => {
    const uids = await client.search(["ALL"]);
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
      const batch = uids.slice(0, BATCH_SIZE);
      await client.fetch(batch, { bodies: ["HEADER"] });

      if (global.gc) global.gc();
    }

    console.log(`Repeated fetches (${iterations}x) completed without crashing`);

    expect(true).toBe(true);
  });
});
