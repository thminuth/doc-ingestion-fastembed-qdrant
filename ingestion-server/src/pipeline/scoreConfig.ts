'use strict';

/**
 * Strategy-specific score scales for the vector threshold.
 *
 * The raw scores returned by the different strategies are not comparable:
 *
 *   dense            -> cosine similarity (roughly 0..1, but with a high baseline
 *                       for E5-style models; unrelated docs often score ~0.8)
 *   late_interaction -> Qdrant MaxSim = SUM of per-query-token maxima, so the
 *                       scale grows with the number of query tokens
 *   rerank           -> raw cross-encoder logit (unbounded, e.g. -11..+11)
 *   colbert_rerank   -> same cross-encoder logit, applied after ColBERT retrieval
 *
 * To make a single 0..1 threshold meaningful for every strategy we normalise the
 * final score:
 *
 *   dense            -> raw cosine
 *   late_interaction -> MaxSim / number of query tokens (mean per token)
 *   rerank(_hybrid)  -> sigmoid(logit)  (0.5 == logit 0)
 *
 * The defaults below were calibrated against the bundled test-data
 * (`test-data/jobs/job_001_java_senior.md` vs related/unrelated candidates).
 */

export type ScoreNormalization = 'none' | 'maxsim_mean' | 'sigmoid';

export interface ThresholdProfile {
  strategy: string;
  /** Short label shown in the UI next to the slider. */
  label: string;
  /** Human readable explanation of what the score means. */
  description: string;
  min: number;
  max: number;
  step: number;
  /** Sensible default for this strategy. */
  default: number;
  normalization: ScoreNormalization;
  /**
   * Fixed raw pre-filter used during retrieval for rerank strategies. The
   * user-facing threshold is applied to the final (reranked) score instead.
   */
  prefilterThreshold: number;
}

export const THRESHOLD_PROFILES: Record<string, ThresholdProfile> = {
  dense: {
    strategy: 'dense',
    label: 'Cosine-Ähnlichkeit',
    description:
      'Kosinus-Ähnlichkeit (0..1). Kurze Queries: relevant ≈ 0.76–0.79, unrelated ≈ 0.71–0.75. Dokument-Queries: relevant ≈ 0.90, unrelated ≈ 0.80. Sinnvoll: 0.74–0.80.',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.76,
    normalization: 'none',
    prefilterThreshold: 0,
  },
  late_interaction: {
    strategy: 'late_interaction',
    label: 'MaxSim (normalisiert)',
    description:
      'MaxSim geteilt durch die Anzahl Query-Tokens (0..1). Kurze Queries: relevant ≈ 0.52–0.58, unrelated ≈ 0.48–0.55. Dokument-Queries: relevant ≈ 0.79–0.81. Sinnvoll: 0.50–0.55.',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.52,
    normalization: 'maxsim_mean',
    prefilterThreshold: 0,
  },
  rerank: {
    strategy: 'rerank',
    label: 'Rerank-Wahrscheinlichkeit',
    description:
      'Cross-Encoder-Logit als Sigmoid (0..1). Unrelated ≈ 0.0001; relevante kurze Queries ≈ 0.005–0.99. 0.5 entspricht Logit 0, 0.01 ≈ Logit −4.6. Sinnvoll: 0.005–0.10.',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0.01,
    normalization: 'sigmoid',
    prefilterThreshold: 0,
  },
  colbert_rerank: {
    strategy: 'colbert_rerank',
    label: 'Rerank-Wahrscheinlichkeit',
    description:
      'Cross-Encoder-Logit als Sigmoid (0..1) nach ColBERT-Retrieval. Unrelated ≈ 0.0001; relevante kurze Queries ≈ 0.005–0.99. 0.5 entspricht Logit 0, 0.01 ≈ Logit −4.6. Sinnvoll: 0.005–0.10.',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0.01,
    normalization: 'sigmoid',
    prefilterThreshold: 0,
  },
};

export const DEFAULT_THRESHOLD_PROFILE = THRESHOLD_PROFILES.dense;

export const getThresholdProfile = (strategy: string): ThresholdProfile =>
  THRESHOLD_PROFILES[strategy] ?? DEFAULT_THRESHOLD_PROFILE;

/**
 * Scale of the *retrieval* stage. For rerank strategies this differs from the
 * final score scale (dense/ColBERT retrieval, then cross-encoder rerank).
 * Used as a safe fallback when reranking fails.
 */
export const getRetrievalProfile = (strategy: string): ThresholdProfile => {
  if (strategy === 'rerank') return THRESHOLD_PROFILES.dense;
  if (strategy === 'colbert_rerank') return THRESHOLD_PROFILES.late_interaction;
  return getThresholdProfile(strategy);
};

/** Serializable copy for the UI (`GET /api/ingest/models`). */
export const getThresholdProfiles = (): Record<string, ThresholdProfile> =>
  THRESHOLD_PROFILES;

/** Convert a raw Qdrant/rerank score into the user-facing 0..1 scale. */
export const normalizeScore = (
  rawScore: number,
  profile: ThresholdProfile,
  queryTokenCount: number,
): number => {
  switch (profile.normalization) {
    case 'maxsim_mean':
      return queryTokenCount > 0 ? rawScore / queryTokenCount : rawScore;
    case 'sigmoid':
      return 1 / (1 + Math.exp(-rawScore));
    case 'none':
    default:
      return rawScore;
  }
};

/**
 * Translate the user-facing threshold into a raw Qdrant `score_threshold`.
 *
 * For rerank strategies the retrieval stage intentionally uses no threshold
 * (a fixed value of 0 means "omit"), because the user threshold applies to the
 * cross-encoder score afterwards.
 */
export const toRawPrefilter = (
  profile: ThresholdProfile,
  threshold: number,
  queryTokenCount: number,
): number => {
  switch (profile.normalization) {
    case 'maxsim_mean':
      return threshold * Math.max(1, queryTokenCount);
    case 'sigmoid':
      return profile.prefilterThreshold;
    case 'none':
    default:
      return threshold;
  }
};
