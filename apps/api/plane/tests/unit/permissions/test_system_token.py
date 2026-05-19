# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import MagicMock

import pytest

from plane.app.permissions import IsSystemToken


def _make_request(auth):
    """Build a minimal stand-in for the DRF ``request`` object.

    ``IsSystemToken.has_permission`` only inspects ``request.auth``;
    mocking is enough and keeps the test free of DB / HTTP scaffolding.
    """
    request = MagicMock()
    request.auth = auth
    return request


@pytest.mark.unit
class TestIsSystemToken:
    """Unit tests for the IsSystemToken DRF permission class."""

    def test_returns_true_when_token_is_service(self):
        token = MagicMock()
        token.is_service = True
        assert (
            IsSystemToken().has_permission(_make_request(token), view=MagicMock())
            is True
        )

    def test_returns_false_when_token_is_not_service(self):
        token = MagicMock()
        token.is_service = False
        assert (
            IsSystemToken().has_permission(_make_request(token), view=MagicMock())
            is False
        )

    def test_returns_false_when_auth_is_none(self):
        """Anonymous / unauthenticated requests carry ``request.auth = None``."""
        assert (
            IsSystemToken().has_permission(_make_request(None), view=MagicMock())
            is False
        )

    def test_returns_false_when_token_missing_is_service_attr(self):
        """Defensive: if a non-APIToken auth object reaches this permission
        (e.g. session auth), ``getattr(..., 'is_service', False)`` defaults
        to False rather than raising."""
        auth = object()  # bare object, no is_service attribute
        assert (
            IsSystemToken().has_permission(_make_request(auth), view=MagicMock())
            is False
        )
