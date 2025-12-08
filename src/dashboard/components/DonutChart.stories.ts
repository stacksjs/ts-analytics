import type { Meta, StoryObj } from '@storybook/vue3'
import DonutChart from './DonutChart.stx'

const meta = {
  title: 'Components/Charts/DonutChart',
  component: DonutChart,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    loading: { control: 'boolean' },
    showLegend: { control: 'boolean' },
  },
} satisfies Meta<typeof DonutChart>

export default meta
type Story = StoryObj<typeof meta>

const sampleData = [
  { label: 'Direct', value: 4234, color: '#3b82f6' },
  { label: 'Organic Search', value: 3456, color: '#10b981' },
  { label: 'Social', value: 2134, color: '#8b5cf6' },
  { label: 'Referral', value: 1234, color: '#f59e0b' },
  { label: 'Email', value: 567, color: '#ef4444' },
]

export const Default: Story = {
  args: {
    data: sampleData,
    title: 'Traffic Sources',
  },
}

export const WithoutTitle: Story = {
  args: {
    data: sampleData,
  },
}

export const Loading: Story = {
  args: {
    data: [],
    title: 'Traffic Sources',
    loading: true,
  },
}

export const TwoSegments: Story = {
  args: {
    data: [
      { label: 'Desktop', value: 6500, color: '#3b82f6' },
      { label: 'Mobile', value: 3500, color: '#10b981' },
    ],
    title: 'Device Split',
  },
}
