export function CardParticles() {
  return (
    <div className="card-preview__particles" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
    </div>
  );
}
