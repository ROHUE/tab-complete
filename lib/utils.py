"""Utility functions."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Product


def calculate_total(products: list["Product"]) -> float:
    """Calculate total price of products."""
    return sum(p.price for p in products)


def format_currency(amount: float) -> str:
    """Format amount as currency string."""
    return f"${amount:,.2f}"


def validate_email(email: str) -> bool:
    """Basic email validation."""
    return "@" in email and "." in email.split("@")[-1]


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    return text.lower().replace(" ", "-").strip("-")
