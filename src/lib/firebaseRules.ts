'use client';
// 설치 화면에서 복사해 쓰는 Firebase 보안 규칙 — 원본: firebase/firestore.rules · firebase/storage.rules
// (원본을 고치면 이 파일도 함께 갱신)

export const FIRESTORE_RULES = `rules_version = '2';

// ============================================================
// O.HOME Firestore 보안 규칙 (v2.3b — 회원 전면 개방 + 초대코드 방문자·회원 방문 등록 수정)
// Firebase 콘솔 → Firestore Database → 규칙 에 붙여넣고 [게시].
//
// 문서 구조
//   meta/owner                      { uid, admins[] }   ← 첫 계정이 1회만 자기를 총관리자로 등록
//   profiles/{uid}                  { nickname, avatarUrl, avatarColor, homeId, joinCode }
//   homes/{homeId}                  { name, inviteCode, createdAt }
//   homes/{homeId}/settings/{key}   { value }           ← 홈마다 테마·메뉴·폰트·메인 위젯
//   homes/{homeId}/visitors/{uid}   { inviteCode, at }  ← 초대코드로 들어온 방문자 (v2.2)
//   homes/{homeId}/<콘텐츠>/{id}     { data, authorId, visibility, sort }
//   invites/{코드}                   { homeId }          ← 코드로 홈을 찾는 조회 전용 (v2.2)
//
// 누가 무엇을 보나
//   · 비로그인: 아무것도 못 읽는다 — 단, 초대코드로 익명 로그인해 방문자가 되면 읽기 가능 (v2.2)
//   · 방문자: 그 홈의 설정과 전체공개·회원공개 콘텐츠를 읽기만. 쓰기·수정·삭제 전부 불가
//   · 회원: 프로필의 homeId 홈 하나 — 그 홈의 설정·콘텐츠 전부를 관리자처럼 다룬다 (v2.3)
//   · 총관리자(meta/owner): 모든 홈 + 홈 만들기/지우기·회원 홈 배정(리스트 관리)만 총관리자 전용
// ============================================================

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function ownerData() {
      return get(/databases/$(database)/documents/meta/owner).data;
    }

    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/meta/owner)
        && (ownerData().uid == request.auth.uid
            || (ownerData().keys().hasAny(['admins']) && request.auth.uid in ownerData().admins));
    }

    function hasProfile() {
      return signedIn() && exists(/databases/$(database)/documents/profiles/$(request.auth.uid));
    }

    function myProfile() {
      return get(/databases/$(database)/documents/profiles/$(request.auth.uid)).data;
    }

    // 이 홈의 회원인가 — 총관리자는 모든 홈
    function inHome(homeId) {
      return isAdmin()
        || (hasProfile() && myProfile().keys().hasAny(['homeId']) && myProfile().homeId == homeId);
    }

    // 이 홈의 방문자인가 — 초대코드로 등록된 사람 (v2.2). 회원은 아니지만 읽기 허용
    function isVisitor(homeId) {
      return signedIn()
        && exists(/databases/$(database)/documents/homes/$(homeId)/visitors/$(request.auth.uid));
    }

    // 이 문서의 작성자가 총관리자인가 — 「관리자의 캐릭터」 보호용 (v2.2)
    function isAdminContent() {
      return resource.data.get('authorId', null) != null
        && (resource.data.authorId == ownerData().uid
            || (ownerData().keys().hasAny(['admins']) && resource.data.authorId in ownerData().admins));
    }

    // 콘텐츠 컬렉션 목록 — 여기 없는 이름은 아무 권한도 없다
    function isContent(name) {
      return name in [
        'posts', 'guestbook', 'characters', 'relations', 'gallery', 'roadview',
        'trpg_logs', 'trpg_log_bodies', 'trpg_chars', 'dotori', 'playlog', 'rp_rooms', 'threads',
        'diary', 'memos', 'commissions', 'applicants', 'moods', 'comments', 'qa_answers', 'rp_messages',
        'notifications', 'thread_posts', 'videos', 'rp_typing'
      ];
    }

    // ── 총관리자 지정 — 아직 없을 때 딱 한 번 ──────────────────────
    match /meta/owner {
      allow read: if true;
      allow create: if signedIn() && !exists(/databases/$(database)/documents/meta/owner);
      allow update, delete: if isAdmin();
    }

    // ── 회원 프로필 ─────────────────────────────────────────────
    //  · 만들기: 본인. homeId를 적으려면 그 홈의 가입코드(joinCode)가 맞아야 한다 —
    //    코드 없이 만드는 프로필은 홈이 없는 계정(총관리자 설치용)이라 아무 홈도 못 본다
    //  · 고치기: 본인은 homeId를 바꿀 수 없다 (닉네임·아바타만). 총관리자는 전부
    match /profiles/{uid} {
      allow read: if signedIn();
      allow create: if isAdmin() || (signedIn() && request.auth.uid == uid && (
        !request.resource.data.keys().hasAny(['homeId'])
        || (exists(/databases/$(database)/documents/homes/$(request.resource.data.homeId))
            && request.resource.data.keys().hasAny(['joinCode'])
            && get(/databases/$(database)/documents/homes/$(request.resource.data.homeId)).data.inviteCode
               == request.resource.data.joinCode)
      ));
      allow update: if isAdmin() || (signedIn() && request.auth.uid == uid
        && request.resource.data.get('homeId', null) == resource.data.get('homeId', null));
      allow delete: if isAdmin();
    }

    // ── 초대코드 → 홈 조회 (v2.2, 방문자·가입 코드 확인용) ─────────
    //  로그인(익명 포함)한 사람은 코드로 홈 id를 조회할 수 있다.
    //  홈 문서의 inviteCode 자체는 계속 닫혀 있어, 코드를 모르면 홈을 열 수 없다.
    match /invites/{code} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    // ── 설치 화면의 연결 확인용 (최상위 settings — 홈 설정은 아래 homes/ 안에 있다) ──
    match /settings/{key} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // ── 홈(자관) ───────────────────────────────────────────────
    //  읽기: 총관리자 전부 · 회원은 자기 홈 · 프로필 없는 새 계정 · 등록된 방문자 (v2.2)
    match /homes/{homeId} {
      allow read: if isAdmin()
        || (signedIn() && !hasProfile())
        || inHome(homeId)
        || isVisitor(homeId);
      allow create, update, delete: if isAdmin();

      // 홈 설정 (읽기 홈 회원·방문자 · 쓰기 홈 회원 — v2.3: 회원도 환경설정을 고친다)
      match /settings/{key} {
        allow read: if inHome(homeId) || isVisitor(homeId);
        allow write: if inHome(homeId);
      }

      // 방문자 등록 (v2.2) — 초대코드를 맞힌 로그인 사용자(익명 포함)가 스스로 한 장 만든다.
      //  다른 홈 소속 회원도 프로필과 무관하게 만들 수 있다. 내용 수정은 불가, 삭제는 본인·총관리자.
      match /visitors/{uid} {
        allow read: if isAdmin() || inHome(homeId)
          || (signedIn() && request.auth.uid == uid);
        // (v2.3b) 코드 대조는 homes 문서가 아니라 invites 조회표로 한다 —
        //   다른 홈 소속 회원은 프로필이 있어 homes 문서를 읽지 못하므로(위 read 규칙),
        //   homes를 대조 기준으로 쓰면 회원 방문자 등록이 전부 거부됐다.
        //   invites는 로그인(익명 포함)이면 누구나 읽을 수 있어 회원·비로그인 모두 통과한다.
        allow create: if signedIn() && request.auth.uid == uid
          && request.resource.data.keys().hasAny(['inviteCode'])
          && exists(/databases/$(database)/documents/invites/$(request.resource.data.inviteCode))
          && get(/databases/$(database)/documents/invites/$(request.resource.data.inviteCode)).data.homeId
             == homeId;
        allow update: if false;
        allow delete: if isAdmin() || (signedIn() && request.auth.uid == uid);
      }

      // 홈 콘텐츠
      match /{coll}/{docId} {
        // 읽기: (홈 회원 — 전체공개/멤버공개/내가 쓴 것/총관리자) 또는
        //       (방문자 — 전체공개·멤버공개까지만, 비공개 글은 못 본다) (v2.2)
        allow read: if isContent(coll) && (
          (inHome(homeId) && (
            resource.data.visibility == 'public'
            || resource.data.visibility == 'member'
            || resource.data.authorId == request.auth.uid
            || isAdmin()
          ))
          || (isVisitor(homeId) && (
            resource.data.visibility == 'public'
            || resource.data.visibility == 'member'
          ))
        );

        // 쓰기(새 글): 홈 회원 — 방문자는 만들 수 없다
        allow create: if isContent(coll) && inHome(homeId);

        // 수정·삭제: 이 홈의 회원이면 누구나 (v2.3 — 관리자의 캐릭터 예외도 없앴다)
        allow update, delete: if isContent(coll) && inHome(homeId);
      }
    }
  }
}
`;

export const STORAGE_RULES = `rules_version = '2';

// ============================================================
// O.HOME Storage 보안 규칙 (이미지·파일)
// Firebase 콘솔 → Storage → 규칙 에 붙여넣고 [게시].
//   · 읽기는 공개 (그림 주소를 아는 사람은 볼 수 있다 — 주소는 홈 안에서만 노출된다)
//   · 올리기·지우기는 로그인 사용자 — 회원이 환경설정까지 고칠 수 있으므로(v2.3) 로그인이면 허용
//   · 한 번에 20MB 초과 업로드 차단
// ============================================================

service firebase.storage {
  match /b/{bucket}/o {
    match /ohome/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null
        && request.resource.size < 20 * 1024 * 1024;
      allow delete: if request.auth != null;
    }
  }
}
`;
