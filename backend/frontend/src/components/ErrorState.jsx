export default function ErrorState({ message, onRetry }) {
  return (
    <div className="stateBox errorBox" role="alert">
      <strong>요청을 처리하지 못했습니다.</strong>
      <p>{message}</p>
      {onRetry && (
        <button className="secondaryButton" type="button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
