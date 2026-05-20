# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import MagicMock

import pytest

from plane.app.permissions import IsSystemToken
from plane.db.models import APIToken


def _make_request(token_value):
    """Build a stand-in for the DRF ``request`` object with X-Api-Key set.

    ``IsSystemToken.has_permission`` only inspects ``request.headers``,
    so mocking the rest of the request keeps tests free of HTTP scaffolding.
    """
    request = MagicMock()
    request.headers = {"X-Api-Key": token_value} if token_value else {}
    return request


@pytest.mark.unit
class TestIsSystemToken:
    """Unit tests for the IsSystemToken DRF permission class."""

    @pytest.mark.django_db
    def test_grants_when_token_is_service(self, create_user):
        APIToken.objects.create(
            user=create_user,
            label="System token",
            token="sys-token-value",
            is_service=True,
        )
        assert (
            IsSystemToken().has_permission(
                _make_request("sys-token-value"), view=MagicMock()
            )
            is True
        )

    @pytest.mark.django_db
    def test_denies_when_token_is_not_service(self, create_user):
        APIToken.objects.create(
            user=create_user,
            label="Plain token",
            token="plain-token-value",
            is_service=False,
        )
        assert (
            IsSystemToken().has_permission(
                _make_request("plain-token-value"), view=MagicMock()
            )
            is False
        )

    def test_denies_when_no_api_key_header(self):
        """Anonymous / session-auth requests carry no X-Api-Key."""
        assert (
            IsSystemToken().has_permission(_make_request(None), view=MagicMock())
            is False
        )

    @pytest.mark.django_db
    def test_denies_when_token_not_in_db(self):
        """Header value is present but doesn't match any APIToken row."""
        assert (
            IsSystemToken().has_permission(
                _make_request("nonexistent-token"), view=MagicMock()
            )
            is False
        )

    @pytest.mark.django_db
    def test_denies_when_token_is_inactive(self, create_user):
        """Service flag is true but the token row is deactivated."""
        APIToken.objects.create(
            user=create_user,
            label="Disabled system token",
            token="disabled-sys-token",
            is_service=True,
            is_active=False,
        )
        assert (
            IsSystemToken().has_permission(
                _make_request("disabled-sys-token"), view=MagicMock()
            )
            is False
        )
