import Button from '../components/Button.jsx'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center px-6 py-32 text-center lg:px-10">
      <span className="text-display text-7xl text-ember">404</span>
      <h1 className="text-display mt-4 text-3xl text-bone">
        This prospect didn't make the board.
      </h1>
      <p className="mt-4 max-w-md text-bone-dim">
        Whatever you were looking for isn't here. Head back to the board and
        try again.
      </p>
      <Button to="/" className="mt-8">
        Back Home
      </Button>
    </div>
  )
}
