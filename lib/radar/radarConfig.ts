export type BubbleType = "Sehr hoch" | "Hoch" | "Niedrig" | "Sehr niedrig";

export type BubbleOverride = {
  label?: string;
  type?: BubbleType;
};

export type BubbleAssetMap = Record<BubbleType, string>;

export const TREND_RADAR_UPLOAD_INPUT_ID = "trend-radar-upload-input";

export const bubbleTypes: BubbleType[] = ["Sehr hoch", "Hoch", "Niedrig", "Sehr niedrig"];

export const bubbleAssetUrls: Record<BubbleType, string> = {
  "Sehr hoch": "/radar-bubbles/sehr-hoch.svg",
  Hoch: "/radar-bubbles/hoch.svg",
  Niedrig: "/radar-bubbles/niedrig.svg",
  "Sehr niedrig": "/radar-bubbles/sehr-niedrig.svg",
};

export const bubbleSymbolIds: Record<BubbleType, string> = {
  "Sehr hoch": "tr-bubble-sehr-hoch",
  Hoch: "tr-bubble-hoch",
  Niedrig: "tr-bubble-niedrig",
  "Sehr niedrig": "tr-bubble-sehr-niedrig",
};

export const bubbleBucketTypeMap: Record<string, BubbleType> = {
  "1": "Sehr hoch",
  "2": "Hoch",
  "3": "Niedrig",
  "4": "Sehr niedrig",
};
