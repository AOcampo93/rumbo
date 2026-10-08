import type { PointCategory } from '@rumbo/route-spec';

/**
 * Category from an item's direct "instance of" (P31), first match in claim
 * order. Q210272 (cultural heritage), which most monuments carry next to
 * their real type, is not in the table and so never decides.
 */
const CATEGORY_OF = new Map<string, PointCategory>(
  Object.entries({
    church: 'Q16970 Q2977 Q108325 Q44613 Q1128397',
    museum: 'Q33506 Q207694 Q1007870',
    monument:
      'Q4989906 Q179700 Q5003624 Q23413 Q57821 Q16560 Q12518 Q483453 Q12280 Q1463776 Q1802963',
    viewpoint: 'Q6017969',
    nature: 'Q22698 Q22746 Q1107656',
    food: 'Q11707 Q30022 Q330284',
    culture: 'Q24354 Q7075 Q2326815 Q483110',
  }).flatMap(([category, ids]) =>
    ids.split(' ').map((id): [string, PointCategory] => [id, category as PointCategory]),
  ),
);

/** The category of an item whose "instance of" ids (P31) are `types`: 'other' when none is known. */
export function categoryFromTypes(types: Iterable<string>): PointCategory {
  for (const type of types) {
    const category = CATEGORY_OF.get(type);
    if (category) return category;
  }
  return 'other';
}
