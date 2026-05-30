export default function EmptyState({ title = "표시할 데이터가 없습니다.", description }) {
  return (
    <div className="stateBox">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
