/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@coc-vtt/shared"],
  // 개발 서버의 오른쪽 아래 표시가 보드 아래 도구 버튼을 가려 e2e 클릭을 막는 일이 있어 끈다.
  devIndicators: false,
};
export default nextConfig;
