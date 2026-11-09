# Mentor Availability API: Team 19 to Team 17

Hi Team 17,

Team 19 (Alumni Network, Pod 5) here. Two things.

**1. We've integrated your Internship API, and it works live.** Your contract meets our needs:
students see your open internships and press **Find a mentor for this** to reach alumni in that
field. The demo listings are fine for the evaluation, and we label them as demo listings. Our call:
`GET /api/placements?status=open&page=1&limit=5&category=Engineering` returned `200` at
2026-11-09 07:13:44 UTC, request ID **a461ec05-1277-4b26-a79a-ed2b280d8ed7**. Here are
[your listings in our app](../evidence/team17-internships-live.png) and
[Find a mentor for this](../evidence/team17-find-a-mentor-live.png). Could you find that ID in your
logs and send us a screenshot, so we both have matching evidence?

**2. Our API for you, so the integration works both ways.** On each internship page, you could show
how many MFU alumni can mentor a student in that field, with a link that opens our alumni directory
already filtered to it:

> **MFU alumni who can mentor you in Software Development: 1 available now.** [Find a mentor](https://alumni-network-integration.phyo2lay.workers.dev/app#/mentors/Software%20Development)

It's public, needs no token, can be called from the browser, and returns no personal data.
Everything you need is below, laid out like your handover to us: the contract, an OpenAPI file, a
Postman collection and real responses. When you call it, send us the `request_id` and a screenshot,
and we'll send you our log entry back.

Also, please keep your API online tomorrow, **10 November, 13:00 to 18:00**, for our final
evaluation.

Thanks,
Team 19

## The contract

| | |
|---|---|
| Provider | Team 19, MFU Alumni Network (Pod 5) |
| Consumer | Team 17, Internship Management (Pod 5) |
| Version | 1.0, 9 November 2026 |
| Base URL | `https://alumni-network-integration.phyo2lay.workers.dev` |
| Endpoint | `GET /api/mentors` |
| Authentication | None. It's public and read-only |
| CORS | Any website may read it (`Access-Control-Allow-Origin: *`), so you can call it from your server or from the browser |
| Personal data | **None.** Only counts and links: no names, IDs or contact details |
| Data | Counts of our fictional demo alumni profiles, which are labelled "(demo)" in our app |
| Files | This guide, [`mentors.openapi.json`](mentors.openapi.json) (OpenAPI 3.1), [`mentors.postman_collection.json`](mentors.postman_collection.json), and real responses: [`example-category.json`](example-category.json), [`example-all.json`](example-all.json), [`example-400.json`](example-400.json) |

## Request

| Parameter | Required | Value |
|---|---|---|
| `category` | No | **Your listing's `category`**, sent as it is: `Design`, `Engineering`, `Data` or `Marketing`, in any case |
| `interest` | No | One of our 17 interests, such as `Software Development` |

Send `category` or `interest`, not both. With neither, every interest is listed. Any other parameter
is refused.

Your categories map to our interests like this:

| Your `category` | Our interest |
|---|---|
| Design | UX/UI Design |
| Engineering | Software Development |
| Data | Data & AI |
| Marketing | Marketing |

## Response

`200`, for `GET /api/mentors?category=Engineering`, captured from the live site:

```json
{
  "data": [
    {
      "interest": "Software Development",
      "mentors_available": 1,
      "find_mentors_url": "https://alumni-network-integration.phyo2lay.workers.dev/app#/mentors/Software%20Development"
    }
  ],
  "meta": {
    "api_version": "1.0",
    "request_id": "ba1b94f0-752a-4d78-b4da-aef57bdc9246",
    "generated_at": "2026-11-09T12:31:55.312Z"
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `data[].interest` | string | Our interest name |
| `data[].mentors_available` | integer, 0 or more | Alumni in this field who can take a mentee **right now**: profile on, open to mentoring, and with room left. It changes as alumni accept students |
| `data[].find_mentors_url` | https URL | Opens our directory filtered to this interest. Students sign in first, then land on the filtered list |
| `meta.api_version` | string | `1.0` |
| `meta.request_id` | UUID | Unique per call. Also in the `X-Request-Id` header and in our log |
| `meta.generated_at` | ISO 8601 UTC | When the counts were taken |

A category maps to one interest today, but read `data` as a list in case that changes.

## Errors

| HTTP | `code` | What to do |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A category we don't map yet, an unknown interest, both filters, or an unknown parameter. `fields` says which. Hide the mentor box. Don't retry |
| 500 | `INTERNAL_ERROR` | Hide the mentor box. Try again on the next page load |
| 403 | Plain text `error code: 1010` | Cloudflare refused your client's `User-Agent` before the request reached us. Python's default `urllib` gets this. Browsers, Node's `fetch` and curl don't |

Errors look like this ([`example-400.json`](example-400.json)):

```json
{ "error": "Some fields are invalid", "code": "VALIDATION_ERROR", "fields": { "category": "Unknown category. Use Design, Engineering, Data or Marketing" } }
```

## Integration steps

1. Agree that a mentor box on internship pages fits your app.
2. Set one configuration value for our base URL.
3. Call `GET /api/mentors?category=<the listing's category>` when the page loads, with a timeout of
   about 10 seconds. Check for status `200`.
4. Show each item as text, for example "*{mentors_available}* MFU alumni can mentor you in
   *{interest}*", with a **Find a mentor** link to `find_mentors_url`, opening in a new tab.
5. When `mentors_available` is `0`, say no alumni are free in that field right now, or hide the box.
6. On a `400`, a `500` or a timeout, hide the box. Your page must keep working without us.
7. Don't poll. Call once per page view. Caching the answer for a few minutes is fine.
8. Keep the `request_id`, the HTTP status and the UTC time of a successful call.
9. Send us that `request_id` and a screenshot of the box on your page. We'll find the same call in
   our log and send you a screenshot back, so both teams hold matching evidence.

```javascript
const res = await fetch(
  `${ALUMNI_BASE_URL}/api/mentors?category=${encodeURIComponent(listing.category)}`,
  { signal: AbortSignal.timeout(10_000) },
);
if (res.ok) {
  const { data, meta } = await res.json();
  // Render data[0].mentors_available, data[0].interest and data[0].find_mentors_url as text and a link.
  console.log('Team 19 request_id', meta.request_id);
}
```

## Try it

```bash
curl -i "https://alumni-network-integration.phyo2lay.workers.dev/api/mentors?category=Engineering"
curl -i "https://alumni-network-integration.phyo2lay.workers.dev/api/mentors"
curl -i "https://alumni-network-integration.phyo2lay.workers.dev/api/mentors?category=Cooking"   # 400
```

Or import [`mentors.postman_collection.json`](mentors.postman_collection.json) into Postman, or use
the console on our docs page:
<https://alumni-network-integration.phyo2lay.workers.dev/docs#mentors>.

## Our side

- 14 automated tests cover the counts, the category mapping, errors, CORS, request IDs, and that no
  name, ID or contact detail ever appears in an answer
  ([`test/partner-mentors.test.ts`](../test/partner-mentors.test.ts)).
- The code: [`src/routes/partner-mentors.ts`](../src/routes/partner-mentors.ts).
- Every call is logged with its `request_id` in Cloudflare Workers observability.

## Handover checklist

- [x] Endpoint live over HTTPS, with no authentication.
- [x] Counts only, no personal data. Covered by tests.
- [x] OpenAPI file, Postman collection and real example responses.
- [x] Links open our directory filtered to the interest, after sign-in. Checked in a browser.
- [ ] Team 17 confirms the mentor box fits their internship pages.
- [ ] Team 17 calls the endpoint from their app.
- [ ] Both teams keep matching `request_id`s, timestamps and screenshots.
