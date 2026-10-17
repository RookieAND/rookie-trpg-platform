import type { Library } from "@coc-vtt/shared";

/** 저장된 서재와, 몇 번째로 저장된 것인지(처음 저장 전에는 0). */
export interface StoredLibrary {
  library: Library;
  revision: number;
}

/** 사용자 한 명의 개인 서재(매크로·직업 정의)를 통째로 읽고 쓰는 저장소(포트). */
export interface LibraryRepository {
  load(userId: string): Promise<StoredLibrary | null>;
  /** 저장소에 있는 번호가 expected와 같을 때만 저장하고 새 번호를 돌려준다. 다르면 null. */
  save(userId: string, library: Library, expected: number): Promise<number | null>;
}
