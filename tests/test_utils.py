"""Tests for utility functions."""

import pytest
from lib.utils import calculate_total, format_currency, validate_email, slugify
from lib.models import Product


class TestCalculateTotal:
    """Tests for calculate_total function."""

    def test_empty_list(self):
        """Should return 0 for empty list."""
        assert calculate_total([]) == 0

    def test_single_product(self):
        """Should return price of single product."""
        product = Product(id=1, name="Test", price=29.99)
        assert calculate_total([product]) == 29.99

    def test_multiple_products(self):
        """Should sum all product prices."""
        products = [
            Product(id=1, name="A", price=10.00),
            Product(id=2, name="B", price=20.00),
            Product(id=3, name="C", price=30.00),
        ]
        assert calculate_total(products) == 60.00


class TestFormatCurrency:
    """Tests for format_currency function."""

    def test_basic_format(self):
        """Should format with dollar sign and 2 decimals."""
        assert format_currency(100) == "$100.00"

    def test_thousands_separator(self):
        """Should include comma for thousands."""
        assert format_currency(1234.56) == "$1,234.56"

    def test_zero(self):
        """Should handle zero."""
        assert format_currency(0) == "$0.00"


class TestValidateEmail:
    """Tests for validate_email function."""

    def test_valid_email(self):
        """Should return True for valid email."""
        assert validate_email("user@example.com") is True

    def test_invalid_no_at(self):
        """Should return False without @."""
        assert validate_email("userexample.com") is False

    def test_invalid_no_domain(self):
        """Should return False without domain."""
        assert validate_email("user@") is False


class TestSlugify:
    """Tests for slugify function."""

    def test_basic_slug(self):
        """Should convert to lowercase with hyphens."""
        assert slugify("Hello World") == "hello-world"

    def test_strip_edges(self):
        """Should strip leading/trailing hyphens."""
        assert slugify(" Test ") == "test"
