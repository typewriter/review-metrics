import { $, argv } from "zx";
import { stringify } from "csv-stringify/sync";
import {
  eachDayOfInterval,
  differenceInSeconds,
  isSaturday,
  isSunday,
} from "date-fns";

$.verbose = false;

const sleep = (msec: number) =>
  new Promise((resolve) => setTimeout(resolve, msec));

const getPrs = async (repo: string) => {
  const result =
    await $`gh pr list --state merged --repo ${repo} --limit 100 --json "number,author,title,createdAt"`;
  return JSON.parse(result.stdout) as GitHubPullRequest[];
};

const getTimelines = async (repo: string, number: number) => {
  const result =
    await $`gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" /repos/${repo}/issues/${number}/timeline`;
  return JSON.parse(result.stdout) as GitHubIssueTimeline[];
};

const guessReviewMetrics = (
  pr: GitHubPullRequest,
  timelines: GitHubIssueTimeline[]
): ReviewMetrics[] => {
  var metrics: ReviewMetrics[] = [];
  var requestedAt: Date | undefined = new Date(pr.createdAt);
  var committedAt: Date | undefined = new Date(pr.createdAt);
  for (const timeline of timelines) {
    if (timeline.event === "committed") {
      committedAt = new Date(timeline.committer?.date!);
    }

    if (timeline.event === "review_requested") {
      requestedAt = new Date(timeline.created_at!);
    }

    if (timeline.event === "reviewed") {
      metrics.push({
        prNumber: pr.number,
        requestedAt: requestedAt || committedAt,
        reviewedAt: new Date(timeline.submitted_at!),
      });
      requestedAt = undefined;
    }
  }
  return metrics;
};

const repo = argv.repo;
const prs = await getPrs(repo);

process.stdout.write(
  stringify([
    [
      "番号",
      "ログインID",
      "タイトル",
      "レビュー依頼日時",
      "レビュー日時",
      "レビュー日数 (営業日のみ)",
    ],
  ])
);

for (const pr of prs) {
  const timelines = await getTimelines(repo, pr.number);
  const metrics = guessReviewMetrics(pr, timelines);
  for (const metric of metrics) {
    const seconds = differenceInSeconds(metric.reviewedAt, metric.requestedAt);
    const holidays = eachDayOfInterval({
      start: metric.requestedAt,
      end: metric.reviewedAt,
    }).filter((day) => isSunday(day) || isSaturday(day)).length;

    const businessSeconds = seconds - holidays * (24 * 60 * 60);

    process.stdout.write(
      stringify([
        [
          pr.number,
          pr.author.login,
          pr.title,
          metric.requestedAt.toISOString(),
          metric.reviewedAt.toISOString(),
          businessSeconds / 24 / 60 / 60,
        ],
      ])
    );
  }

  await sleep(1000);
}

type GitHubPullRequest = {
  number: number;
  title: string;
  author: {
    login: string;
    name: string;
  };
  createdAt: string;
};

type GitHubIssueTimeline = {
  event:
    | "review_requested"
    | "committed"
    | "reviewed"
    | "merged"
    | "commented"
    | string;
  /** コミット時 */
  author?: {
    name: string;
    email: string;
    date: string;
  };
  /** コミット時 */
  committer?: {
    name: string;
    email: string;
    date: string;
  };
  /** コメント、レビュー時 */
  user?: {
    login: string;
  };
  /** コメント時、レビュー依頼時、マージ時 */
  created_at?: string;
  /** レビュー時 */
  state?: "approved" | string;
  /** レビュー時 */
  submitted_at?: string;
};

type ReviewMetrics = {
  prNumber: number;
  requestedAt: Date;
  reviewedAt: Date;
};
