"use client";
import { useEffect } from "react";
import { ErrorPanel } from "@/shared/ui";

/** 화면 어딘가에서 예외가 나면 흰 화면 대신 이 안내를 보여 준다. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorPanel title="문제가 생겼어요" description="새로고침해 보세요. 계속 안 되면 잠시 뒤에 다시 들어와 주세요." onRetry={reset} digest={error.digest} />;
}
