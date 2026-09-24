from typing import Optional
import logging

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 100

class SaleOrder:
    _name = 'sale.order'
    _inherit = 'sale.order'

    def _compute_amount(self):
        for order in self:
            total = sum(line.price_total for line in order.line_ids)
            order.amount_total = total

    def action_confirm(self):
        self.ensure_one()
        self.state = 'confirmed'
        return True

def helper_function(value: Optional[str] = None) -> str:
    return value or 'default'
