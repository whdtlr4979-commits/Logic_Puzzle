// 사이트에 등록된 게임 목록.
// 새 게임을 추가할 때는 games/<id>/ 폴더를 만들고 여기에 한 항목만 추가하면 된다.
export const GAMES = [
  {
    id: 'skyscraper',
    title: '스카이스크래퍼',
    subtitle: 'Skyscrapers',
    path: 'games/skyscraper/',
    thumbnail: 'games/skyscraper/thumb.svg',
    description:
      '격자에 높이가 다른 빌딩을 세우세요. 바깥쪽 숫자는 그 방향에서 보이는 빌딩의 수입니다. 3D 도시를 돌려 보며 풀 수 있어요.',
    tags: ['3D', '4×4 ~ 7×7', '라틴 방진'],
    accent: '#5b8cff',
  },
];
