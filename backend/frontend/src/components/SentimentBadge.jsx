import { sentimentInfo } from "../utils/articlePresentation";

export default function SentimentBadge({ label }) {
  const info = sentimentInfo(label);
  return (
    <span className={`sentimentBadge sentimentBadge--${info.category}`} aria-label={`감성: ${info.label}`}>
      <span aria-hidden="true">{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
}
