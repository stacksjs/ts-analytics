import type { Meta, StoryObj } from '@storybook/vue3'
import RealtimeCounter from './RealtimeCounter.vue'

const meta = {
  title: 'Components/Core/RealtimeCounter',
  component: RealtimeCounter,
  tags: ['autodocs'],
  argTypes: {
    count: { control: { type: 'number', min: 0, max: 1000 } },
    label: { control: 'text' },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof RealtimeCounter>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    count: 42,
    label: 'Active Visitors',
  },
}

export const HighCount: Story = {
  args: {
    count: 847,
    label: 'Current Users',
  },
}

export const ZeroCount: Story = {
  args: {
    count: 0,
    label: 'Active Sessions',
  },
}

export const Loading: Story = {
  args: {
    count: 0,
    label: 'Active Visitors',
    loading: true,
  },
}
