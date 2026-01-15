"""Main application module for testing tab completion."""

from lib.utils import calculate_total, format_currency
from lib.models import User, Product


def process_order(user: User, products: list[Product]) -> dict:
    """Process an order for a user."""
    subtotal = calculate_total(products)
    tax = subtotal * 0.08
    total = subtotal + tax

    return {
        "user_id": user.id,
        "user_name": user.name,
        "subtotal": format_currency(subtotal),
        "tax": format_currency(tax),
        "total": format_currency(total),
        "items": [p.name for p in products]
    }


def main():
    """Entry point."""
    user = User(id=1, name="Alice", email="alice@example.com")
    products = [
        Product(id=101, name="Widget", price=29.99),
        Product(id=102, name="Gadget", price=49.99),
    ]

    result = process_order(user, products)
    print(f"Order processed: {result}")


if __name__ == "__main__":
    main()
