/** 글을 파일로 저장한다. 서버를 거치지 않고 이 브라우저에서 바로 내려받는다. */
export function downloadText(filename: string, text: string, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
