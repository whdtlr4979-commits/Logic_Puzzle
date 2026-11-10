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
  {
    id: 'tents',
    title: '나무와 텐트',
    subtitle: 'Trees & Tents',
    path: 'games/tents/',
    thumbnail: 'games/tents/thumb.svg',
    description:
      '나무마다 텐트를 하나씩 바로 옆에 치세요. 텐트끼리는 대각선으로도 닿으면 안 되고, 바깥 숫자는 그 줄의 텐트 수예요. 3D 캠핑장에서 풀어요.',
    tags: ['3D', '6×6 ~ 12×12', '배치 퍼즐'],
    accent: '#2f9e58',
  },
];
