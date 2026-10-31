import { z } from "zod";

/**
 * Google Places API (New) shapes we use, and how a place becomes an import
 * row. Only the fields in PLACES_FIELD_MASK are requested (cost is per SKU,
 * driven by the mask). Unknown keys are stripped, so reviewer names and
 * photos never reach the database.
 */

export const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
export const placeDetailsUrl = (placeId: string) =>
  `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryType",
  "nextPageToken",
].join(",");

export const PLACE_REVIEWS_FIELD_MASK = "id,reviews.text,reviews.rating,reviews.publishTime";

const addressComponent = z.object({
  longText: z.string().optional(),
  shortText: z.string().optional(),
  types: z.array(z.string()).default([]),
});

export const placeSchema = z.object({
  id: z.string().min(1).max(300),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  addressComponents: z.array(addressComponent).default([]),
  nationalPhoneNumber: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  googleMapsUri: z.string().optional(),
  businessStatus: z.string().optional(),
  primaryType: z.string().optional(),
});
export type Place = z.infer<typeof placeSchema>;

export const textSearchResponseSchema = z.object({
  places: z.array(placeSchema).default([]),
  nextPageToken: z.string().optional(),
});
export type TextSearchResponse = z.infer<typeof textSearchResponseSchema>;

export const placeReviewsSchema = z.object({
  id: z.string().optional(),
  reviews: z
    .array(
      z.object({
        text: z.object({ text: z.string() }).optional(),
        rating: z.number().optional(),
        publishTime: z.string().optional(),
      }),
    )
    .default([]),
});

/** Build the Text Search query for one niche in one city, e.g. "clínica odontológica em Chapecó". */
export function buildQuery(template: string, niche: string, city: string): string {
  return template.replaceAll("{niche}", niche.trim()).replaceAll("{city}", city.trim()).replace(/\s+/g, " ").trim();
}

export interface PlaceExtras {
  placeId: string;
  address: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
}

/** A place as a manual-import-shaped row (so it goes through the same validation, opt-out and dedupe) plus Places-only extras. */
export function placeToRow(place: Place, niche: string): { row: Record<string, string>; extras: PlaceExtras } | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") return null;
  const comp = (type: string) => place.addressComponents.find((c) => c.types.includes(type));
  const city = comp("administrative_area_level_2")?.longText ?? comp("locality")?.longText;
  const state = comp("administrative_area_level_1")?.shortText;
  const row: Record<string, string> = { company: name, niche };
  if (city) row.city = city;
  if (state) row.state = state;
  const phone = place.internationalPhoneNumber ?? place.nationalPhoneNumber;
  if (phone) row.phone = phone;
  if (place.websiteUri) row.website = place.websiteUri;
  return {
    row,
    extras: {
      placeId: place.id,
      address: place.formattedAddress ?? null,
      mapsUrl: place.googleMapsUri ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
    },
  };
}
