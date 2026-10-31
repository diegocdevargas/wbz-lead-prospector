import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { retryDelaySeconds } from "../src/jobs.ts";
import { buildQuery, placeSchema, placeToRow, textSearchResponseSchema } from "../src/places.ts";
import { countPainPhrases } from "../src/reviews.ts";

const place = placeSchema.parse({
  id: "ChIJabc",
  displayName: { text: "Clínica Teste" },
  formattedAddress: "Rua A, 1 - Centro, Erechim - RS",
  addressComponents: [
    { longText: "Erechim", shortText: "Erechim", types: ["administrative_area_level_2", "political"] },
    { longText: "Rio Grande do Sul", shortText: "RS", types: ["administrative_area_level_1", "political"] },
  ],
  nationalPhoneNumber: "(54) 3321-0000",
  websiteUri: "https://clinica.test/",
  rating: 4.5,
  userRatingCount: 30,
  businessStatus: "OPERATIONAL",
});

describe("places", () => {
  it("builds the query from the template", () => {
    expect(buildQuery("{niche} em {city}", " clínica odontológica ", "Chapecó, SC")).toBe(
      "clínica odontológica em Chapecó, SC",
    );
  });

  it("maps a place to an import row plus extras", () => {
    expect(placeToRow(place, "dentista")).toEqual({
      row: {
        company: "Clínica Teste",
        niche: "dentista",
        city: "Erechim",
        state: "RS",
        phone: "(54) 3321-0000",
        website: "https://clinica.test/",
      },
      extras: {
        placeId: "ChIJabc",
        address: "Rua A, 1 - Centro, Erechim - RS",
        mapsUrl: null,
        rating: 4.5,
        reviewCount: 30,
      },
    });
  });

  it("skips closed businesses and places without a name", () => {
    expect(placeToRow({ ...place, businessStatus: "CLOSED_PERMANENTLY" }, "x")).toBeNull();
    expect(placeToRow({ ...place, displayName: undefined }, "x")).toBeNull();
  });

  it("strips fields we did not ask for (reviewer names, photos)", () => {
    const parsed = textSearchResponseSchema.parse({
      places: [{ id: "a", photos: [{ authorAttributions: [{ displayName: "X" }] }] }],
    });
    expect(parsed.places[0]).not.toHaveProperty("photos");
  });
});

describe("countPainPhrases", () => {
  it("counts reviews per pain, accent-insensitive", () => {
    expect(
      countPainPhrases([
        "Demoram para responder no WhatsApp",
        "Muito DIFÍCIL agendar",
        "Não atendem o telefone e não respondem",
        "Ótimo!",
      ]),
    ).toEqual({ reviewed: 4, counts: { slow_reply: 2, whatsapp: 0, phone: 1, booking: 1 } });
  });
});

describe("retryDelaySeconds", () => {
  it("backs off exponentially and caps at 6h", () => {
    expect([1, 2, 3].map((a) => retryDelaySeconds(a, defaultConfig))).toEqual([30, 120, 480]);
    expect(retryDelaySeconds(20, defaultConfig)).toBe(6 * 3600);
  });
});
