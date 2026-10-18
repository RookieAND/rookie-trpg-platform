import { ErrorPanel } from "@/shared/ui";

export default function NotFound() {
  return <ErrorPanel title="찾을 수 없어요" description="주소가 잘못됐거나 사라진 페이지예요. 로비에서 다시 찾아보세요." />;
}
