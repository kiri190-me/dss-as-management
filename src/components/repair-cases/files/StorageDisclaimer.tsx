export default function StorageDisclaimer() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p className="font-semibold">이 화면은 파일 메타데이터 데모입니다.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>실제 파일은 업로드되거나 저장되지 않습니다.</li>
        <li>NAS, 악성코드 검사, 미리보기 생성은 아직 연결되지 않았습니다.</li>
        <li>실제 파일 내용의 검사·해시가 아닌, 입력한 메타데이터만 다룹니다.</li>
        <li>브라우저 localStorage는 개발자 도구로 열람·수정될 수 있어 기밀 정보나 개인정보를 다루기에 적합하지 않습니다.</li>
      </ul>
    </div>
  );
}
