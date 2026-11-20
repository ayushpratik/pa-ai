# Business Development Ninja - Cost Estimate

Prepared 2026-11-20 as an input to the pricing model. This is a modeled estimate, not
measured usage. Vendor prices come from third-party summaries (the vendors' own pages could not
be retrieved), so confirm each figure on the vendor site before fixing a price.

A **thread** is one lead-finding job: clarify, plan, approve, search and extract, save, then
optionally enrich contacts and draft or send outreach. It is typically 5-8 user messages.

## Where the money goes

| Service | Used for | Billed by |
| --- | --- | --- |
| Gemini 3.5 Flash-Lite | Every chat step, the scope check on each message, record extraction, memory extraction | Tokens |
| Serper.dev | Web search (2-6 searches per thread) | Credits per query |
| Apollo.io | People search, and email reveal (enrichment) per contact | Credits, inside a seat plan |
| Email (SMTP or Gmail) | Sending outreach | No per-message vendor cost |

Page fetching runs on our own server and has no vendor cost.

## Unit prices used

| Service | Price | Confidence |
| --- | --- | --- |
| Gemini 3.5 Flash-Lite | $0.30 per 1M input tokens, $2.50 per 1M output tokens (thinking counts as output). Batch is half. Cached input $0.03 per 1M. | Third-party; official page not retrieved |
| Serper.dev | Entry pack $50 for 50,000 credits ($0.001 each), falling to about $0.0003 at volume. 1 credit for up to 10 results, reportedly 2 credits for 11-100. Free tier of 2,500. | Third-party only; Serper publishes no pricing page |
| Apollo.io | Seats at $49, $79 and $119 per month (annual billing), each with a monthly credit allowance. Email reveal 1 credit (some tests saw about 2). Phone reveal 8 credits. Extra credits reported near $0.17. Credits inside a plan work out to roughly $0.05-0.10. People search is 0 or 1 credit per page (sources conflict). | Third-party; read docs.apollo.io/docs/api-pricing |

## Cost per thread

| Thread type | Gemini | Serper | Apollo | Total |
| --- | --- | --- | --- | --- |
| Light: 20 results, no enrichment | $0.05-0.12 | about $0.003 | $0-0.17 | **$0.05-0.30** |
| Typical: 50 results, enrich 10, draft 10 | $0.15-0.30 | about $0.006 | $0.50-3.40 | **$0.70-3.70** |
| Heavy: 100 results, enrich 25, draft 25, send | $0.30-0.60 | about $0.012 | $1.25-8.50 | **$1.60-9.10** |

Gemini and Serper together cost cents. Apollo enrichment is 85-95% of the cost whenever it is
used. The worst single turn on Gemini (16 steps at about 60k tokens each) is about $0.30.

## Per user per month

| Profile | Assumption | Gemini | Serper | Apollo | Total per month | Per working day |
| --- | --- | --- | --- | --- | --- | --- |
| Light | 4 threads, no enrichment | $0.5 | $0.02 | $0 | **$0.5-1** | about $0.04 |
| Typical | 20 threads (one per workday), 10 enrichments each | $3-6 | $0.15 | 300 credits, $15-51 | **$20-55** | $1-2.5 |
| Heavy | 60 threads (three per day), 25 enrichments each | $15-30 | $0.60 | 2,250 credits, $112-380 | **$130-410** | $6-20 |

Shared fixed costs, not per user: a server (a DigitalOcean-class VPS, about $12-48 per month,
Postgres on the same host), domain and TLS, and an SMTP provider if Gmail's sending limits are
outgrown.

## Notes for the pricing model

1. Gemini and Serper are marginal, about $0.10-0.60 per thread. A base seat fee covers them.
2. Apollo is the real variable cost. Price enrichment as a credit bucket (N reveals included per
   month, overage billed per reveal) rather than a flat fee. A heavy user on a flat fee can cost
   ten times a typical one.
3. Apollo is sold as a seat plan with a credit allowance, so at low volume the real cost is the
   fixed seat fee ($49-119), not the per-credit rate. One shared Apollo seat serving many users
   will exhaust its credits and hit rate limits.

## To confirm with the vendors

- Which Apollo plan includes API access, and whether `/mixed_people/search` consumes credits.
- How Serper bills a request for 100 results. Google capped a results page at about 10 in
  September 2025, so a 100-result search may be paginated or return fewer.
- Gemini's official token prices and what share of output is thinking tokens.
- Actual usage: run three real threads (light, typical, heavy) and compare the Google AI Studio
  billing page, the Serper dashboard and Apollo's credit-usage page with the tables above.
