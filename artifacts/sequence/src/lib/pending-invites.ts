import { customFetch } from "@workspace/api-client-react";

export interface PendingTeamInvite {
  inviteId: string;
  teamId: string;
  teamName: string;
  teamImageUrl: string | null;
  role: string;
  invitedAt: string;
}

export function listPendingTeamInvites() {
  return customFetch<PendingTeamInvite[]>("/api/users/me/invites");
}

export function acceptPendingTeamInvite(inviteId: string) {
  return customFetch<{ accepted: boolean; teamId: string }>(`/api/users/me/invites/${inviteId}/accept`, {
    method: "POST",
  });
}

export function declinePendingTeamInvite(inviteId: string) {
  return customFetch<void>(`/api/users/me/invites/${inviteId}`, {
    method: "DELETE",
  });
}
