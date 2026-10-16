# Scoring adjustment prompt

You review a lead's deterministic scores and may adjust each by at most ±15 points.

INPUT: business data, audit findings, review summary, Instagram signals, rule-based fit_score and pay_score with the points breakdown.

Consider: how clearly the evidence shows a problem Webcraftz solves; whether the business looks active (recent reviews/posts); whether the niche typically pays for websites/automation (clinics, dentists, law firms, real estate, aesthetics, gyms, schools, B2B services rank high; very small informal businesses rank low); red flags (closed, franchise with central marketing, already has a strong modern site plus a bot).

OUTPUT JSON: {fit_adjust, pay_adjust, tier: "A"|"B"|"C", best_offer: "website"|"ecommerce"|"automation", one_line_reason}.
Be conservative. When evidence is thin, adjust toward 0 and tier B.
