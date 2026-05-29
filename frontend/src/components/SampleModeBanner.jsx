export default function SampleModeBanner({ message }) {
  return (
    <div className="sampleModeBanner" role="status">
      <strong>샘플 데이터 모드</strong>
      <span>{message || "백엔드 API 요청 실패로 화면 확인용 샘플 데이터를 표시합니다."}</span>
    </div>
  );
}
