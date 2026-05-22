# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Regression coverage for the "PRC colleagues can't log in" incident
(2026-05-21):

The Lark directory sync (``lark_sync_task.sync_lark_directory``)
bulk-creates ``User`` rows from the Feishu contacts crawl but did NOT
create the corresponding ``Profile`` rows — those were only created on
the interactive OAuth signup path (``complete_login_or_signup``). For
users who were directory-synced FIRST and then later signed in via
OAuth, ``complete_login_or_signup`` short-circuits at the
"user already exists" branch and never reaches the Profile-create line.

Symptom in production: ``/api/users/me/profile/`` and
``/api/users/me/settings/`` returned 404 (``Profile.DoesNotExist``
converted by the exception middleware), and the web app sat on a
loading spinner forever. 447 of 452 ``@lark.local`` users were
affected.

This module asserts the two defensive contracts:
  1. ``ProfileEndpoint.get`` self-heals on a missing Profile row.
  2. The settings endpoint via ``UserMeSettingsSerializer`` does the same.
  3. ``lark_sync_task`` writes a Profile alongside every new User.
"""

import pytest
from rest_framework import status

from plane.db.models import Profile, User, Workspace, WorkspaceMember


@pytest.fixture
def session_user_without_profile(db):
    """A User row that has NO related Profile — the exact shape
    ``lark_sync_task`` was leaving behind."""
    user = User.objects.create(
        email="sync-orphan@lark.local",
        username="sync_orphan",
        first_name="Sync",
        last_name="Orphan",
        is_password_autoset=True,
        is_email_verified=True,
    )
    assert not Profile.objects.filter(user=user).exists(), (
        "fixture invariant: this user should start without a Profile"
    )
    return user


@pytest.fixture
def session_client_without_profile(api_client, session_user_without_profile):
    api_client.force_authenticate(user=session_user_without_profile)
    return api_client


@pytest.mark.contract
class TestProfileEndpointSelfHeal:
    """``GET /api/users/me/profile/`` must NOT 404 when the Profile row
    is missing — it must lazily create one and return 200."""

    @pytest.mark.django_db
    def test_get_profile_creates_missing_profile_row(
        self, session_client_without_profile, session_user_without_profile
    ):
        response = session_client_without_profile.get("/api/users/me/profile/")
        assert response.status_code == status.HTTP_200_OK, response.content
        assert Profile.objects.filter(user=session_user_without_profile).exists()

    @pytest.mark.django_db
    def test_get_settings_creates_missing_profile_row(
        self, session_client_without_profile, session_user_without_profile
    ):
        # The settings endpoint reads via UserMeSettingsSerializer.get_workspace
        # which ALSO did Profile.objects.get and triggered the 404 separately.
        response = session_client_without_profile.get("/api/users/me/settings/")
        assert response.status_code == status.HTTP_200_OK, response.content
        assert Profile.objects.filter(user=session_user_without_profile).exists()


@pytest.mark.contract
class TestLarkSyncCreatesProfile:
    """The root-cause fix: when ``sync_lark_directory`` creates a User,
    it must also create a Profile in the same atomic block so a later
    OAuth signin doesn't have to backfill it."""

    @pytest.mark.django_db
    def test_sync_creates_profile_alongside_user(self, db, create_user, mocker):
        from plane.bgtasks import lark_sync_task

        workspace = Workspace.objects.create(
            name="Lark Sync WS",
            owner=create_user,
            slug="lark-sync-ws",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=create_user, role=20)

        # Bypass the live Lark API; hand the sync a synthesised contact list.
        mocker.patch.object(
            lark_sync_task, "_tenant_access_token", return_value=("fake-token", None)
        )
        mocker.patch.object(
            lark_sync_task,
            "_crawl_directory",
            return_value=[
                {
                    "union_id": "on_test_unique_001",
                    "open_id": "ou_test_unique_001",
                    "enterprise_email": "",
                    "email": "",
                    "name": "Byron Han",
                },
            ],
        )

        stats = lark_sync_task.sync_lark_directory(
            workspace.slug, force_refresh=True
        )
        assert stats.get("users_created", 0) == 1, stats

        # User created with the synthetic identifier, AND Profile alongside.
        user = User.objects.get(email="on_test_unique_001@lark.local")
        profile = Profile.objects.get(user=user)
        # Pre-marked as fully onboarded — directory-sync users should never
        # see the "Create your profile" interstitial.
        assert profile.is_onboarded is True
        assert profile.is_tour_completed is True
        assert profile.onboarding_step == {
            "profile_complete": True,
            "workspace_create": True,
            "workspace_invite": True,
            "workspace_join": True,
        }

    @pytest.mark.django_db
    def test_sync_backfills_profile_on_pre_existing_user(
        self, db, create_user, mocker
    ):
        """An older User row left by previous sync runs (User present,
        Profile missing) should get its Profile created on the next sync
        pass — exactly the 447-user backlog we hand-backfilled."""
        from plane.bgtasks import lark_sync_task

        workspace = Workspace.objects.create(
            name="Lark Sync WS 2",
            owner=create_user,
            slug="lark-sync-ws-2",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=create_user, role=20)

        # Pre-stage a user without a Profile — the exact production shape.
        orphan = User.objects.create(
            email="on_test_unique_002@lark.local",
            username="orphan_002",
            first_name="Orphan",
            last_name="",
        )
        assert not Profile.objects.filter(user=orphan).exists()

        mocker.patch.object(
            lark_sync_task, "_tenant_access_token", return_value=("fake-token", None)
        )
        mocker.patch.object(
            lark_sync_task,
            "_crawl_directory",
            return_value=[
                {
                    "union_id": "on_test_unique_002",
                    "open_id": "ou_test_unique_002",
                    "enterprise_email": "",
                    "email": "",
                    "name": "Orphan Backfill",
                },
            ],
        )

        lark_sync_task.sync_lark_directory(workspace.slug, force_refresh=True)
        assert Profile.objects.filter(user=orphan).exists(), (
            "Profile must be lazily created on re-sync for an older User row"
            " — this is the path that recovers the 447-user backlog without"
            " needing a manual data fixup."
        )
