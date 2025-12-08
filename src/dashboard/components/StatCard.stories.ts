import type { Meta, StoryObj } from '@storybook/vue3'
import StatCard from './StatCard.stx'

const meta = {
  title: 'Components/Core/StatCard',
  component: StatCard,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    value: { control: 'text' },
    change: { control: { type: 'number', min: -1, max: 1, step: 0.01 } },
    icon: { control: 'text' },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof StatCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    label: 'Total Visitors',
    value: '24,847',
  },
}

export const WithChange: Story = {
  args: {
    label: 'Page Views',
    value: '89,234',
    change: 0.12,
  },
}

export const NegativeChange: Story = {
  args: {
    label: 'Bounce Rate',
    value: '42.3%',
    change: -0.05,
  },
}

export const Loading: Story = {
  args: {
    label: 'Total Visitors',
    value: '24,847',
    loading: true,
  },
}

export const WithIcon: Story = {
  args: {
    label: 'Active Users',
    value: '1,234',
    change: 0.08,
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
}
