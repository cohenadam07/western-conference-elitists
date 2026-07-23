"""Step-1 console harness: pull headlines, dedupe, rank, print. No page written."""
from .feeds import pull_headlines
from .dedupe import group_stories, rank_clusters
from .util import get_logger


def main():
    log = get_logger()
    log.info("=== Step 1: headlines pull + dedupe ===")
    items, stats = pull_headlines(log)
    log.info("pulled %d items (%d feeds ok, %d dead, %d dropped by filter)",
             len(items), stats["feeds_ok"], stats["feeds_dead"], stats["dropped"])

    clusters = group_stories(items)
    ranked = rank_clusters(clusters)
    log.info("grouped into %d stories; top 30:", len(clusters))
    print()
    for i, r in enumerate(ranked[:30], 1):
        also = f"  +{len(r['also_covered_by'])} more" if r["also_covered_by"] else ""
        print(f"{i:2d}. [{r['_n_outlets']}x] {r['outlet']:<24}{also}")
        print(f"    {r['title']}")
        print(f"    {r['published']}  {r['url']}")
        if r["also_covered_by"]:
            print(f"    also: {', '.join(r['also_covered_by'])}")
        print()


if __name__ == "__main__":
    main()
