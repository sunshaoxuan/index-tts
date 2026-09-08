const ACCENT_GUIDANCE_PATTERN = /(?:口音|方言|accent|dialect|(?:成都|四川|重庆|东北|北京|上海|河南|山东|陕西|湖南|湖北|广东|广西|台湾|香港|粤语|闽南|关西|大阪|博多|美式|英式)(?:话|腔|音))/iu;

export function segmentAccentGuidance(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text && ACCENT_GUIDANCE_PATTERN.test(text) ? text : undefined;
}
