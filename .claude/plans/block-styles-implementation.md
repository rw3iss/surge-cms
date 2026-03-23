# Block Styles Implementation Plan

## Implementation Order

1. **Shared types** - BlockStyle interfaces
2. **Database** - Migration for block_styles table + block style_id column
3. **Backend** - CRUD endpoints, block resolution with style population
4. **Frontend service** - BlockStyleService with caching
5. **BlockStyleEditor component** - Reusable style editor UI
6. **Block header integration** - Style dropdown + edit button in ContentBlock
7. **Block preview** - Preview button and render view
8. **Block output styling** - Apply styles in BlockRenderer and Post renderer
9. **Seed default style**
