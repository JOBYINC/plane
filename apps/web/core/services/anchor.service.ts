/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type { IState, TIssuesResponse } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/** Raw section row from the public anchor endpoint (no project_id/workspace_id). */
export type TAnchorSection = {
  id: string;
  name: string;
  sort_order: number;
  is_collapsed_default: boolean;
};

/** Raw member row from the public anchor endpoint. */
export type TAnchorMember = {
  id: string;
  member: string;
  member__display_name: string;
  member__avatar: string;
};

/**
 * Per-issue dependency relations shaped to match the app's
 * `issue_relation`/`issue_related` expand so the web relation store's
 * `extractRelationsFromIssues` can consume it directly.
 */
export type TAnchorRelation = {
  id: string;
  issue_relation: { id: string; relation_type: string }[];
  issue_related: { id: string; relation_type: string }[];
};

/** Subset of the DeployBoard settings payload the embed needs. */
export type TAnchorSettings = {
  project: string;
  project_details?: { id: string; name: string; identifier: string } | null;
  workspace_detail?: { id: string; name: string; slug: string } | null;
};

/**
 * Read-only client for a published project's public (anchor-gated) Timeline
 * data. Every endpoint is `AllowAny` on the API side, so these calls never need
 * a session — they back the unauthenticated `/embed/timeline/:anchor` route.
 */
export class AnchorService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getSettings(anchor: string): Promise<TAnchorSettings> {
    return this.get(`/api/public/anchor/${anchor}/settings/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getIssues(anchor: string): Promise<TIssuesResponse> {
    // No group_by → the response is a flat (ALL_ISSUES-keyed) TIssuesResponse,
    // identical in shape to the authed project issues endpoint (same grouper),
    // so it can be fed straight into the issue store's `onfetchIssues`.
    return this.get(`/api/public/anchor/${anchor}/issues/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getStates(anchor: string): Promise<IState[]> {
    return this.get(`/api/public/anchor/${anchor}/states/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getSections(anchor: string): Promise<TAnchorSection[]> {
    return this.get(`/api/public/anchor/${anchor}/sections/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getMembers(anchor: string): Promise<TAnchorMember[]> {
    return this.get(`/api/public/anchor/${anchor}/members/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getRelations(anchor: string): Promise<TAnchorRelation[]> {
    return this.get(`/api/public/anchor/${anchor}/relations/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }
}
