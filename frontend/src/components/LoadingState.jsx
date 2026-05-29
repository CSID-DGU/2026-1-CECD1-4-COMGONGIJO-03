export default function LoadingState({ label = "데이터를 불러오는 중입니다." }) {
  return (
    <div className="stateBox" role="status">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}
