import { CheckCircle2, Eye, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { LogFilter, VerificationLog } from "./types";
import { truncateText } from "./utils";

type VerificationLogCardProps = {
  filteredLogs: VerificationLog[];
  filter: LogFilter;
  onFilterChange: (value: LogFilter) => void;
  onViewDetails: (log: VerificationLog) => void;
};

const FILTERS: LogFilter[] = ["ALL", "VERIFIED", "FAILED"];

export const VerificationLogCard = ({
  filteredLogs,
  filter,
  onFilterChange,
  onViewDetails,
}: VerificationLogCardProps) => {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-xl">Transaction Verification Log</CardTitle>
        <CardDescription>
          Every BillDesk transaction with exact reason and scanned counts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={filter === option ? "default" : "outline"}
              size="sm"
              onClick={() => onFilterChange(option)}
              className="rounded-full text-xs"
            >
              {option}
            </Button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border/60">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left border-b border-border bg-secondary/20">
                <th className="w-[110px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="w-[170px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Transaction ID
                </th>
                <th className="w-[130px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Student ID
                </th>
                <th className="w-[170px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  BillDesk Event
                </th>
                <th className="py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Reason
                </th>
                <th className="w-[180px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Participants
                </th>
                <th className="w-[76px] py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  View
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => (
                <tr
                  key={`${log.transactionId}-${log.studentId}-${index}`}
                  className="border-b border-border/60 align-top"
                >
                  <td className="py-2 px-3 text-sm font-semibold">
                    <span
                      className={
                        log.verificationStatus === "VERIFIED"
                          ? "text-success inline-flex items-center gap-1"
                          : "text-destructive inline-flex items-center gap-1"
                      }
                    >
                      {log.verificationStatus === "VERIFIED" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      {log.verificationStatus}
                    </span>
                  </td>

                  <td className="py-2 px-3 text-sm text-foreground">
                    <span
                      className="block truncate"
                      title={log.transactionId || "-"}
                    >
                      {truncateText(log.transactionId, 18) || "-"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm text-foreground">
                    <span
                      className="block truncate"
                      title={log.studentId || "-"}
                    >
                      {truncateText(log.studentId, 16) || "-"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm text-foreground">
                    <span
                      className="block truncate"
                      title={log.billdeskEvent || "-"}
                    >
                      {truncateText(log.billdeskEvent, 26) || "-"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">
                    <span className="block truncate" title={log.reason}>
                      {truncateText(log.reason, 72)}
                    </span>
                  </td>

                  <td className="py-2 px-3 text-sm text-foreground">
                    {log.matchedParticipants.length ? (
                      <div className="space-y-1">
                        <div
                          className="truncate"
                          title={`${log.matchedParticipants[0].name || "Unknown"} (${log.matchedParticipants[0].studentId || "No ID"})`}
                        >
                          {truncateText(
                            log.matchedParticipants[0].name || "Unknown",
                            18,
                          )}
                        </div>
                        {log.matchedParticipants.length > 1 && (
                          <div className="text-xs text-muted-foreground">
                            +{log.matchedParticipants.length - 1} more
                            participant(s)
                          </div>
                        )}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>

                  <td className="py-2 px-3 text-sm text-foreground">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onViewDetails(log)}
                      title="View full details"
                      aria-label="View full details"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredLogs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No transactions for selected filter.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
