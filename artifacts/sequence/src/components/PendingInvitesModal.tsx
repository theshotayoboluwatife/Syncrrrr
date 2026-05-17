import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getListTeamsQueryKey } from "@workspace/api-client-react";
import {
  acceptPendingTeamInvite,
  declinePendingTeamInvite,
  listPendingTeamInvites,
  type PendingTeamInvite,
} from "@/lib/pending-invites";
import { reportError } from "@/lib/error-reporting";

function TeamInviteImage({ invite }: { invite: PendingTeamInvite }) {
  if (invite.teamImageUrl) {
    return (
      <img
        src={invite.teamImageUrl}
        alt=""
        className="w-12 h-12 rounded-xl object-cover border border-border flex-shrink-0"
      />
    );
  }

  return (
    <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary border border-primary/20 flex items-center justify-center text-sm font-semibold flex-shrink-0">
      {(invite.teamName[0] || "T").toUpperCase()}
    </div>
  );
}

export function PendingInvitesModal() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const invitesQuery = useQuery({
    queryKey: ["pending-team-invites"],
    queryFn: listPendingTeamInvites,
    refetchInterval: 60000,
  });

  const visibleInvites = useMemo(
    () => (invitesQuery.data ?? []).filter((invite) => !dismissedIds.has(invite.inviteId)),
    [dismissedIds, invitesQuery.data],
  );
  const invite = visibleInvites[0] ?? null;

  const acceptInvite = useMutation({
    mutationFn: acceptPendingTeamInvite,
    onMutate: (inviteId) => {
      setActiveInviteId(inviteId);
      setMessage("");
    },
    onSuccess: async (result, inviteId) => {
      setDismissedIds((current) => new Set(current).add(inviteId));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pending-team-invites"] }),
        queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() }),
      ]);
      navigate(`/teams/${result.teamId}/library`);
    },
    onError: (error) => {
      reportError(error, { area: "teams", action: "accept email invite" });
      setMessage("We could not accept that invite. Please try again.");
    },
    onSettled: () => setActiveInviteId(null),
  });

  const declineInvite = useMutation({
    mutationFn: declinePendingTeamInvite,
    onMutate: (inviteId) => {
      setActiveInviteId(inviteId);
      setMessage("");
    },
    onSuccess: async (_result, inviteId) => {
      setDismissedIds((current) => new Set(current).add(inviteId));
      await queryClient.invalidateQueries({ queryKey: ["pending-team-invites"] });
    },
    onError: (error) => {
      reportError(error, { area: "teams", action: "decline email invite" });
      setMessage("We could not decline that invite. Please try again.");
    },
    onSettled: () => setActiveInviteId(null),
  });

  if (!invite) return null;

  const isWorking = activeInviteId === invite.inviteId;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <TeamInviteImage invite={invite} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Team invitation</h2>
            <p className="text-sm text-muted-foreground truncate">{invite.teamName}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          You have been invited to join this team as {invite.role === "admin" ? "an admin" : "a member"}.
        </p>

        {message && <p className="text-xs text-destructive">{message}</p>}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            disabled={isWorking}
            onClick={() => acceptInvite.mutate(invite.inviteId)}
            className="flex-1 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {isWorking && acceptInvite.isPending ? "Joining..." : "Accept"}
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => declineInvite.mutate(invite.inviteId)}
            className="flex-1 border border-border text-foreground rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isWorking && declineInvite.isPending ? "Declining..." : "Decline"}
          </button>
        </div>
      </div>
    </div>
  );
}
