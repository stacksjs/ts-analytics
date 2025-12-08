import type { Meta, StoryObj } from '@storybook/vue3'
import TopList from './TopList.stx'

const meta = {
  title: 'Components/Lists/TopList',
  component: TopList,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    valueLabel: { control: 'text' },
    maxItems: { control: { type: 'number', min: 1, max: 20 } },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof TopList>

export default meta
type Story = StoryObj<typeof meta>

const sampleItems = [
  { name: '/home', value: 12847, change: 0.12 },
  { name: '/products', value: 8923, change: 0.08 },
  { name: '/about', value: 5634, change: 0.24 },
  { name: '/blog', value: 4521, change: -0.05 },
  { name: '/contact', value: 2134, change: 0.03 },
]

export const Default: Story = {
  args: {
    items: sampleItems,
    title: 'Top Pages',
    valueLabel: 'Views',
  },
}

export const WithoutChanges: Story = {
  args: {
    items: sampleItems.map(({ name, value }) => ({ name, value })),
    title: 'Top Referrers',
    valueLabel: 'Visitors',
  },
}

export const Loading: Story = {
  args: {
    items: [],
    title: 'Top Pages',
    loading: true,
  },
}

export const LimitedItems: Story = {
  args: {
    items: sampleItems,
    title: 'Top 3 Pages',
    valueLabel: 'Views',
    maxItems: 3,
  },
}
